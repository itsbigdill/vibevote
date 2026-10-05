#!/usr/bin/env python3
"""Prepare the candidate-profile research run.

- gives every race and candidate a stable id (race: CA-12, FL-SEN-S, OH-GOV; candidate: race/slug),
- matches candidates who sit in Congress today against the open congress-legislators data and
  downloads their official portraits (public domain) into photos/official/,
- writes profiles/in/bNNN.json batches for the research agents, grouped by state.
"""
import json
import re
import subprocess
import time
import unicodedata
from collections import defaultdict
from pathlib import Path

from build import CAND, HOUSE, PHOTOS, STATE_CODES, office_of, slug

ROOT = Path(__file__).resolve().parent
IN = ROOT / "profiles" / "in"
OFFICIAL = PHOTOS / "official"
UA = "VibeVoteBuild/0.1 (+https://vibevote.us)"
LEGIS = "https://unitedstates.github.io/congress-legislators/legislators-current.json"
SOCIAL = "https://unitedstates.github.io/congress-legislators/legislators-social-media.json"
PORTRAIT = "https://unitedstates.github.io/images/congress/450x550/{}.jpg"
BATCH = 12
SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b")
POSTAL = {name: code.upper() for name, code in STATE_CODES.items()}


def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    s = SUFFIX.sub(" ", re.sub(r"[^a-z ]+", " ", s.replace("-", " ")))
    return " ".join(w for w in s.split() if len(w) > 1)


def fetch_json(url):
    out = subprocess.run(["curl", "-fsSL", "--max-time", "120", "-A", UA, url], check=True, capture_output=True).stdout
    return json.loads(out)


def race_id(state, office, district=None):
    st = POSTAL[state]
    if district:
        return district
    return {"US Senate": f"{st}-SEN", "US Senate (special)": f"{st}-SEN-S", "Governor": f"{st}-GOV"}[office]


def load_candidates():
    rows = []
    for f in sorted(CAND.glob("g*.json")):
        for rc in json.loads(f.read_text()):
            office = office_of(rc["office"])
            rid = race_id(rc["state"], office)
            label = f"{rc['state']} · {office}"
            rows += [(rc, rid, label, c) for c in rc["candidates"]]
    for f in sorted(HOUSE.glob("h*.json")):
        for rc in json.loads(f.read_text()):
            rid = rc["district"]
            label = f"{rc['state']} · US House {rid}"
            rows += [(rc, rid, label, c) for c in rc["candidates"]]
    return rows


def match_members(rows, members):
    by_state = defaultdict(list)
    for m in members:
        by_state[m["terms"][-1]["state"]].append(m)
    found, unmatched_incumbents = {}, []
    for rc, rid, label, c in rows:
        st = POSTAL[rc["state"]]
        cand = norm(c["name"]).split()
        if not cand:
            continue
        hits = []
        for m in by_state[st]:
            last = norm(m["name"]["last"]).split()
            if cand[-len(last):] != last:
                continue
            firsts = {norm(m["name"].get(k, "")).split()[0] for k in ("first", "nickname", "official_full") if norm(m["name"].get(k, ""))}
            first_ok = cand[0] in firsts or any(f[:3] == cand[0][:3] for f in firsts)
            hits.append((first_ok, m))
        strong = [m for ok, m in hits if ok]
        pick = strong[0] if len(strong) == 1 else (hits[0][1] if len(hits) == 1 and c.get("incumbent") else None)
        if pick:
            found[f"{rid}/{slug(c['name'])}"] = pick
        elif c.get("incumbent") and rid.split("-")[1] not in ("GOV",):
            unmatched_incumbents.append(f"{rid} {c['name']}")
    return found, unmatched_incumbents


def download_portrait(bioguide):
    dest = OFFICIAL / f"{bioguide}.jpg"
    if dest.exists() and dest.stat().st_size > 1000:
        return True
    raw = dest.with_suffix(".raw")
    r = subprocess.run(["curl", "-fsSL", "--max-time", "60", "-A", UA, "-o", str(raw), PORTRAIT.format(bioguide)])
    if r.returncode != 0:
        raw.unlink(missing_ok=True)
        return False
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "70", "-Z", "240", str(raw), "--out", str(dest)],
                   capture_output=True)
    raw.unlink(missing_ok=True)
    time.sleep(0.15)
    return dest.exists()


def main():
    rows = load_candidates()
    members = fetch_json(LEGIS)
    social = {s["id"]["bioguide"]: s.get("social", {}) for s in fetch_json(SOCIAL)}
    found, unmatched = match_members(rows, members)
    OFFICIAL.mkdir(parents=True, exist_ok=True)
    portraits = sum(download_portrait(m["id"]["bioguide"]) for m in {m["id"]["bioguide"]: m for m in found.values()}.values())

    items, seen = [], set()
    for rc, rid, label, c in rows:
        cid = f"{rid}/{slug(c['name'])}"
        if cid in seen:
            continue
        seen.add(cid)
        m = found.get(cid)
        s = social.get(m["id"]["bioguide"], {}) if m else {}
        items.append({
            "id": cid,
            "name": c["name"],
            "party": c["party"],
            "race": rid,
            "race_label": label,
            "race_status": rc.get("status", "Nominees set"),
            "incumbent": bool(c.get("incumbent")),
            "member_of_congress": {
                "bioguide": m["id"]["bioguide"],
                "official_name": m["name"].get("official_full"),
                "chamber": "Senate" if m["terms"][-1]["type"] == "sen" else "House",
                "official_site": m["terms"][-1].get("url"),
                "official_social": {k: v for k, v in s.items() if k in ("twitter", "facebook", "youtube", "instagram") and v},
                "official_portrait": (OFFICIAL / f"{m['id']['bioguide']}.jpg").exists(),
            } if m else None,
            "existing": {
                "positions": c.get("positions"),
                "basis": c.get("basis", ""),
                "sources": c.get("sources", []),
                "photo": c.get("photo"),
            },
        })

    IN.mkdir(parents=True, exist_ok=True)
    for old in IN.glob("b*.json"):
        old.unlink()
    batches = [items[i:i + BATCH] for i in range(0, len(items), BATCH)]
    for n, batch in enumerate(batches, 1):
        (IN / f"b{n:03d}.json").write_text(json.dumps(batch, ensure_ascii=False, indent=1))
    labels = [f"{b[0]['race']} … {b[-1]['race']}" for b in batches]
    (IN / "_batches.json").write_text(json.dumps(labels, ensure_ascii=False))
    print(f"candidates {len(items)} · batches {len(batches)} · sitting members matched {len(found)} · portraits {portraits}")
    print("incumbents not matched to a sitting member:", unmatched or "none")


if __name__ == "__main__":
    main()
