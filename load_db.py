#!/usr/bin/env python3
"""Load races, candidates, positions and platforms into the vibevote D1 database.

Sources: candidates/g*.json and candidates/house/h*.json (who is on the ballot), profiles/in and
profiles/out (research profiles; a candidate without one keeps the older data), and licensed
portraits: official congressional photos from photos/official/ and free Wikimedia Commons files.
Portraits are copied to public/img/, so run build.py and deploy after loading.

Only rows that differ from what the database already holds are written: D1's free tier allows
100,000 written rows a day, and a full reload costs about 60,000.

Usage: python3 load_db.py [--local] [--env staging|production] [--dry-run] [--full]
  --local    use the local development database instead of the remote one
  --env      the remote environment to load (default production); staging has its own database
  --dry-run  show what would change without writing anything
  --full     wipe and reload every row (expensive; only to recover a broken database)
"""
import json
import re
import shutil
import subprocess
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from build import DOMAINS, PHOTOS, PUBLIC, fetch_photo, free_photo, slug
from prep_profiles import POSTAL, load_candidates

ROOT = Path(__file__).resolve().parent
PROFILES = ROOT / "profiles"
SQL = ROOT / "data-src" / "db_load.sql"
IMG = PUBLIC / "img"
CREDITS = Path(__file__).resolve().parent / "data-src" / "credits.json"  # rendered into /credits by build.py
SOCIAL_KEYS = ("x", "instagram", "facebook", "tiktok", "youtube", "threads", "bluesky")
KIND_SORT = {"senate": 0, "senate_special": 1, "governor": 2, "house": 3, "delegate": 3}
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def text(v, limit):
    return re.sub(r"\s+", " ", v).strip()[:limit] if isinstance(v, str) else ""


def url(v):
    v = text(v, 500)
    return v if re.match(r"^https?://[^\s\"'<>]+$", v) else ""


def score(v):
    ok = isinstance(v, (int, float)) and not isinstance(v, bool)
    return max(0, min(100, int(round(v / 5) * 5))) if ok else None


def race_meta(rid):
    head, _, seat = rid.partition("-")
    if seat == "SEN":
        return "senate", "US Senate", 0
    if seat == "SEN-S":
        return "senate_special", "US Senate · Special election", 0
    if seat == "GOV":
        return "governor", "Governor", 0
    if seat == "DEL":
        return "delegate", "US House · Delegate", 0
    if seat == "AL":
        return "house", "US House · At-large", 0
    return "house", f"US House · District {int(seat)}", int(seat)


def load_profiles():
    inputs, outputs = {}, {}
    for f in sorted((PROFILES / "in").glob("b*.json")):
        for item in json.loads(f.read_text()):
            inputs[item["id"]] = item
    for f in sorted((PROFILES / "out").glob("b*.json")):
        try:
            rows = json.loads(f.read_text())
        except Exception as e:
            print(f"! {f.name}: unreadable ({e})")
            continue
        for p in rows if isinstance(rows, list) else []:
            if isinstance(p, dict) and p.get("id") in inputs:
                outputs[p["id"]] = p
    # the second, deeper pass rewrote the profiles it covered, so its version wins
    for f in sorted((PROFILES / "deep").glob("d*.json")):
        try:
            rows = json.loads(f.read_text())
        except Exception as e:
            print(f"! deep/{f.name}: unreadable ({e})")
            continue
        for p in rows if isinstance(rows, list) else []:
            if isinstance(p, dict) and p.get("id") in inputs:
                outputs[p["id"]] = p
    return inputs, outputs


def portrait(cid, member, profile, existing, problems):
    """Returns (site path, credit, source url) for a licensed portrait, or (None, None, None)."""
    IMG.mkdir(parents=True, exist_ok=True)
    if member and member.get("official_portrait"):
        src = PHOTOS / "official" / f"{member['bioguide']}.jpg"
        if src.exists():
            (IMG / "official").mkdir(exist_ok=True)
            shutil.copy2(src, IMG / "official" / src.name)
            return f"/img/official/{src.name}", "Official portrait, U.S. Congress (public domain)", "https://github.com/unitedstates/images"
    # a profile's photo decision is final: checkers removed photos with doubtful licences on purpose
    for photo in ([profile.get("photo")] if profile else [existing]):
        p = free_photo(photo) if isinstance(photo, dict) and photo.get("file") != "official" else None
        if not p:
            continue
        dest = PHOTOS / f"{slug(cid.replace('/', '-'))}.jpg"
        if not fetch_photo(p["file"], dest):
            problems.append(f"photo download failed: {cid} ({p['file']})")
            continue
        shutil.copy2(dest, IMG / dest.name)
        return (f"/img/{dest.name}", f"{text(p.get('author'), 120) or 'Unknown author'}, {text(p['license'], 40)}, Wikimedia Commons",
                "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(p["file"].replace(" ", "_"), safe=":/()"))
    return None, None, None


TABLES = {  # table: (key columns, value columns)
    "races": (["id"], ["state", "kind", "title", "status", "photos_complete", "sort"]),
    "candidates": (["id"], ["race_id", "name", "party", "incumbent", "bioguide", "current_role", "bio", "website",
                            "social", "photo", "photo_credit", "campaign_photo_url", "notes", "sort"]),
    "positions": (["candidate_id", "domain"], ["score", "evidence", "source"]),
    "platform": (["candidate_id", "ord"], ["topic", "point", "source"]),
}
PARENTS_FIRST = ["races", "candidates", "positions", "platform"]
STAMPED = {"races", "candidates"}  # tables with an updated_at column


def sql_value(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(int(v))
    return "'" + str(v).replace("'", "''") + "'"


def target_env():
    env = sys.argv[sys.argv.index("--env") + 1] if "--env" in sys.argv else "production"
    if env not in ("staging", "production"):
        sys.exit("--env must be staging or production")
    return env


def d1(args, local):
    # local development uses the top-level config; a remote load always names its environment
    env = target_env()
    target = ["--local"] if local else ["--remote", "--env", env]
    name = "vibevote" if local or env == "production" else f"vibevote-{env}"
    return subprocess.run(["npx", "wrangler", "d1", "execute", name, *target, *args, "--yes"],
                          cwd=ROOT, capture_output=True, text=True)


def current_rows(table, local):
    keys, cols = TABLES[table]
    r = d1(["--json", "--command", f"SELECT {', '.join(keys + cols)} FROM {table}"], local)
    start = r.stdout.find("[")
    if r.returncode != 0 or start < 0:
        sys.exit(f"could not read {table}: {(r.stdout + r.stderr).strip()[-600:]}")
    rows = json.loads(r.stdout[start:])[0]["results"]
    return {tuple(row[k] for k in keys): tuple(row[c] for c in cols) for row in rows}


def upserts(table, rows, chunk=40):
    keys, cols = TABLES[table]
    stamp = ["updated_at"] if table in STAMPED else []
    names = keys + cols + stamp
    update = ", ".join(f"{c} = excluded.{c}" for c in cols + stamp)
    items = list(rows.items())
    out = []
    for i in range(0, len(items), chunk):
        values = ",\n".join("(" + ",".join(sql_value(v) for v in (*k, *v, *([NOW] if stamp else []))) + ")"
                            for k, v in items[i:i + chunk])
        out.append(f"INSERT INTO {table} ({', '.join(names)}) VALUES\n{values}\n"
                   f"ON CONFLICT({', '.join(keys)}) DO UPDATE SET {update};")
    return out


def deletes(table, gone):
    keys, _ = TABLES[table]
    return [f"DELETE FROM {table} WHERE " + " AND ".join(f"{c} = {sql_value(v)}" for c, v in zip(keys, k)) + ";" for k in gone]


def desired_state(problems):
    inputs, profiles = load_profiles()
    shutil.rmtree(IMG, ignore_errors=True)
    races, cands, positions, platform = {}, {}, {}, {}
    photo_state, credits = {}, []
    for n, (rc, rid, label, c) in enumerate(load_candidates()):
        cid = f"{rid}/{slug(c['name'])}"
        if (cid,) in cands:
            continue
        kind, title, seat = race_meta(rid)
        races.setdefault((rid,), [POSTAL[rc["state"]], kind, title, text(rc.get("status"), 80) or "Nominees set",
                                  0, KIND_SORT[kind] * 100 + seat])
        item, prof = inputs.get(cid, {}), profiles.get(cid)
        member = item.get("member_of_congress")
        photo, credit, source = portrait(cid, member, prof, c.get("photo"), problems)
        photo_state.setdefault(rid, []).append(bool(photo))
        if photo:
            credits.append({"name": text((prof or {}).get("name"), 120) or c["name"], "race": title, "state": rc["state"],
                            "kind": "commons" if "commons.wikimedia" in source else "official", "credit": credit, "source": source})

        p = prof or {}
        social = {k: url(v) for k, v in (p.get("social") or {}).items() if k in SOCIAL_KEYS and url(v)}
        if member:
            official = member.get("official_social") or {}
            if official.get("twitter") and "x" not in social:
                social["x"] = f"https://x.com/{official['twitter']}"
            if official.get("instagram") and "instagram" not in social:
                social["instagram"] = f"https://www.instagram.com/{official['instagram']}"
            if official.get("facebook") and "facebook" not in social:
                social["facebook"] = f"https://www.facebook.com/{official['facebook']}"
        website = url(p.get("website")) or url((member or {}).get("official_site"))
        cands[(cid,)] = (rid, text(p.get("name"), 120) or c["name"], text(p.get("party"), 60) or c["party"],
                         int(bool(c.get("incumbent"))), (member or {}).get("bioguide"), text(p.get("current_role"), 120),
                         text(p.get("bio"), 700), website, json.dumps(social, ensure_ascii=False), photo, credit,
                         url(p.get("campaign_photo")) or None, text(p.get("notes"), 400), n)

        old = c.get("positions") or {}
        new = p.get("positions") if isinstance(p.get("positions"), dict) else {}
        fallback_src = next((u for u in map(url, c.get("sources") or []) if u), "")
        for d in DOMAINS:
            entry = new.get(d) if prof else None
            if isinstance(entry, dict) and score(entry.get("score")) is not None:
                positions[(cid, d)] = (score(entry.get("score")), text(entry.get("evidence"), 300), url(entry.get("source")))
            elif not prof and score(old.get(d)) is not None:
                # the older data has one summary for all domains, which reads as noise repeated under each scale
                positions[(cid, d)] = (score(old.get(d)), "", fallback_src)
        for i, pt in enumerate((p.get("platform") or [])[:8]):
            if isinstance(pt, dict) and text(pt.get("point"), 240):
                platform[(cid, i)] = (text(pt.get("topic"), 40) or "Priority", text(pt.get("point"), 240), url(pt.get("source")))

    for rid, flags in photo_state.items():
        races[(rid,)][4] = int(all(flags))
    CREDITS.write_text(json.dumps(sorted(credits, key=lambda r: (r["state"], r["race"], r["name"])), ensure_ascii=False, indent=0))
    state = {"races": {k: tuple(v) for k, v in races.items()}, "candidates": cands, "positions": positions, "platform": platform}
    print(f"races {len(races)} · candidates {len(cands)} · profiled {sum(1 for (cid,) in cands if cid in profiles)} · "
          f"with photo {sum(1 for v in cands.values() if v[9])} · races with every photo {sum(v[4] for v in races.values())} · "
          f"positions {len(positions)} · platform points {len(platform)}")
    return state


def main():
    local, dry, full = ("--local" in sys.argv), ("--dry-run" in sys.argv), ("--full" in sys.argv)
    problems = []
    want = desired_state(problems)
    for p in problems:
        print("!", p)

    if full:
        statements = [f"DELETE FROM {t};" for t in reversed(PARENTS_FIRST)]
        have = {t: {} for t in PARENTS_FIRST}
    else:
        statements = []
        have = {t: current_rows(t, local) for t in PARENTS_FIRST}

    report, writes = [], 0
    for t in reversed(PARENTS_FIRST):  # children first, so no delete cascades
        gone = [k for k in have[t] if k not in want[t]]
        statements += deletes(t, gone)
        writes += 2 * len(gone)
        if gone:
            report.append(f"{t} -{len(gone)}")
    for t in PARENTS_FIRST:
        added = {k: v for k, v in want[t].items() if k not in have[t]}
        changed = {k: v for k, v in want[t].items() if k in have[t] and have[t][k] != v}
        statements += upserts(t, {**added, **changed})
        writes += 2 * len(added) + len(changed)
        if added or changed:
            report.append(f"{t} +{len(added)} ~{len(changed)}")

    target = "local" if local else "remote"
    if full:
        writes += 2 * sum(len(have_t) for have_t in want.values())
    if not report and not full:
        print(f"{target} database is already up to date")
        return
    print(f"{target} changes: {', '.join(report) or 'full reload'} · about {writes:,} rows written")
    SQL.write_text("\n".join(statements) + "\n")
    if dry:
        print(f"dry run: nothing written; the SQL is in {SQL.relative_to(ROOT)}")
        return
    r = d1(["--file", str(SQL)], local)
    print("\n".join((r.stdout + r.stderr).strip().splitlines()[-4:]))
    if r.returncode != 0:
        sys.exit("d1 import failed")


if __name__ == "__main__":
    main()
