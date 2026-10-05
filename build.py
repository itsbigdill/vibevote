#!/usr/bin/env python3
"""Build the VibeVote site into public/.

Merges researched 2026 candidates (candidates/g*.json), keeps Wikimedia Commons
photos only when every candidate in a race has a free-licensed one, copies
portraits and state flags next to the page, writes public/data/ballot.json and
public/index.html.
"""
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import urllib.parse
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "web" / "index.src.html"
PUBLIC = ROOT / "public"
CAND, PHOTOS = ROOT / "candidates", ROOT / "photos"
HOUSE = CAND / "house"
HOUSE_READY = HOUSE / "READY"  # created once the House research has been verified
DISTRICT = re.compile(r"^([A-Z]{2})-(\d{1,2}|AL|DEL)$")
VERSION_MARKER = "__BALLOT_VERSION__"
ZIP_MARKER = "__ZIP_VERSION__"
ZCTA_URL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt"
FIPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
    "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
    "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
    "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
    "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
    "56": "WY", "60": "AS", "66": "GU", "69": "MP", "72": "PR", "78": "VI",
}
UA = "VibeVoteBuild/0.1 (personal non-commercial project)"
DOMAINS = ["economy", "welfare", "liberty", "security", "immigration", "foreign", "energy", "tech", "education", "faith"]
STATE_CODES = {
    "Alabama": "al", "Alaska": "ak", "Arizona": "az", "Arkansas": "ar", "California": "ca", "Colorado": "co", "Connecticut": "ct",
    "Delaware": "de", "Florida": "fl", "Georgia": "ga", "Hawaii": "hi", "Idaho": "id", "Illinois": "il", "Indiana": "in",
    "Iowa": "ia", "Kansas": "ks", "Kentucky": "ky", "Louisiana": "la", "Maine": "me", "Maryland": "md", "Massachusetts": "ma",
    "Michigan": "mi", "Minnesota": "mn", "Mississippi": "ms", "Missouri": "mo", "Montana": "mt", "Nebraska": "ne", "Nevada": "nv",
    "New Hampshire": "nh", "New Jersey": "nj", "New Mexico": "nm", "New York": "ny", "North Carolina": "nc", "North Dakota": "nd",
    "Ohio": "oh", "Oklahoma": "ok", "Oregon": "or", "Pennsylvania": "pa", "Rhode Island": "ri", "South Carolina": "sc",
    "South Dakota": "sd", "Tennessee": "tn", "Texas": "tx", "Utah": "ut", "Vermont": "vt", "Virginia": "va", "Washington": "wa",
    "West Virginia": "wv", "Wisconsin": "wi", "Wyoming": "wy", "District of Columbia": "dc",
}
STATES = list(STATE_CODES)
OFFICE_ORDER = {"US Senate": 0, "US Senate (special)": 1, "Governor": 2}
UNRELIABLE_SOURCES = ("nvgov2026.org",)  # AI-assisted voter guides are not primary sources
FREE = re.compile(r"^\s*(public domain|pd\b|cc0|cc[ -]?by(-sa)?\b)", re.I)
NONFREE = re.compile(r"\b(nc|nd)\b|fair use|non-?free", re.I)
# State and local government photos are not automatically public domain the way federal works are.
NONFEDERAL_GOV = re.compile(r"\b(city|county|town|township|borough|village|parish|council|board of|supervisors|legislature|legislative|"
                            r"general assembly|state senate|state house|house of delegates|state of|commonwealth of|governor)\b", re.I)
FEDERAL_GOV = re.compile(r"\b(u\.?\s?s\.?\s+(house|senate|government|congress)|united states|federal|congress(ional)?|"
                         r"house office of photography|senate photographic|library of congress|white house|national guard|"
                         r"army|navy|air force|marine corps|coast guard|nasa)\b", re.I)
MAX_CANDIDATES = 10


def slug(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def office_of(raw):
    t = str(raw).lower()
    if "senate" in t:
        return "US Senate (special)" if "special" in t else "US Senate"
    if "governor" in t and "lieutenant" not in t:
        return "Governor"
    return None


def positions_of(raw):
    out = {}
    for d in DOMAINS:
        v = (raw or {}).get(d)
        ok = isinstance(v, (int, float)) and not isinstance(v, bool)
        out[d] = max(0, min(100, int(round(v / 5) * 5))) if ok else None
    return out


def free_photo(photo):
    if not isinstance(photo, dict):
        return None
    lic, title, author = str(photo.get("license", "")), str(photo.get("file", "")), str(photo.get("author", ""))
    if not (FREE.match(lic) and not NONFREE.search(lic) and title.lower().startswith("file:")):
        return None
    if re.match(r"\s*(public domain|pd\b)", lic, re.I) and NONFEDERAL_GOV.search(author) and not FEDERAL_GOV.search(author):
        return None
    return photo


def curl_image(url, dest):
    r = subprocess.run(["curl", "-sSL", "--max-time", "30", "-A", UA, "-o", str(dest), "-w", "%{http_code} %{content_type}", url],
                       capture_output=True, text=True)
    code, _, ctype = r.stdout.strip().partition(" ")
    return code, ctype


def fetch_photo(title, dest):
    if dest.exists() and dest.stat().st_size > 500:
        return True
    name = re.sub(r"^file:", "", title, flags=re.I).strip()
    url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(name.replace(" ", "_")) + "?width=320"
    raw = dest.with_suffix(".raw")
    for attempt in range(3):
        code, ctype = curl_image(url, raw)
        if code == "200" and ctype.startswith("image/") and raw.exists() and raw.stat().st_size > 1000:
            conv = subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "62", "-Z", "200", str(raw), "--out", str(dest)],
                                  capture_output=True)
            raw.unlink(missing_ok=True)
            time.sleep(0.3)  # be gentle with Commons
            return conv.returncode == 0 and dest.exists()
        if code in ("400", "404"):
            break
        time.sleep(2 * (attempt + 1))
    raw.unlink(missing_ok=True)
    return False


def candidate_of(c):
    return {
        "name": str(c["name"]).strip(),
        "party": str(c["party"]).strip(),
        "incumbent": bool(c.get("incumbent")),
        "positions": positions_of(c.get("positions")),
        "sources": [u for u in (c.get("sources") or [])
                    if isinstance(u, str) and u.startswith("http") and not any(s in u for s in UNRELIABLE_SOURCES)][:3],
        "_photo": free_photo(c.get("photo")),
    }


def load_races(problems):
    seen, races = set(), []
    for f in sorted(CAND.glob("g*.json")):
        try:
            data = json.loads(f.read_text())
        except Exception as e:
            problems.append(f"{f.name}: unreadable JSON ({e})")
            continue
        for rc in data if isinstance(data, list) else []:
            state, office = rc.get("state"), office_of(rc.get("office", ""))
            if state not in STATES or not office:
                problems.append(f"{f.name}: skipped race {state!r} / {rc.get('office')!r}")
                continue
            if (state, office) in seen:
                problems.append(f"{f.name}: duplicate {state} {office}")
                continue
            cands = []
            for c in (rc.get("candidates") or [])[:MAX_CANDIDATES]:
                if not c.get("name") or not c.get("party"):
                    problems.append(f"{f.name}: {state} {office}: candidate without name or party")
                    continue
                cands.append(candidate_of(c))
            if not cands:
                problems.append(f"{f.name}: {state} {office}: no candidates")
                continue
            seen.add((state, office))
            races.append({"state": state, "office": office, "status": str(rc.get("status") or "Nominees set").strip(), "candidates": cands})
    return races


def load_house(problems):
    """US House races from candidates/house/h*.json, keyed by district code (CA-12, AK-AL, DC-DEL)."""
    seen, races = set(), []
    for f in sorted(HOUSE.glob("h*.json")):
        try:
            data = json.loads(f.read_text())
        except Exception as e:
            problems.append(f"house/{f.name}: unreadable JSON ({e})")
            continue
        for rc in data if isinstance(data, list) else []:
            state = rc.get("state")
            m = DISTRICT.match(str(rc.get("district") or "").strip().upper())
            if state not in STATES or not m or m.group(1) != STATE_CODES[state].upper():
                problems.append(f"house/{f.name}: skipped {state!r} / {rc.get('district')!r}")
                continue
            seat = m.group(2) if m.group(2) in ("AL", "DEL") else str(int(m.group(2)))
            district = f"{m.group(1)}-{seat}"
            if district in seen:
                problems.append(f"house/{f.name}: duplicate {district}")
                continue
            cands = [candidate_of(c) for c in (rc.get("candidates") or [])[:MAX_CANDIDATES] if c.get("name") and c.get("party")]
            if not cands:
                problems.append(f"house/{f.name}: {district}: no candidates")
                continue
            seen.add(district)
            races.append({"state": state, "district": district, "office": "US House (delegate)" if seat == "DEL" else "US House",
                          "status": str(rc.get("status") or "Nominees set").strip(), "candidates": cands})
    return races


def seat_order(district):
    seat = district.split("-")[1]
    return int(seat) if seat.isdigit() else 0


def attach_photos(races, problems):
    """Every candidate in a race gets a portrait, or none of them do."""
    PHOTOS.mkdir(exist_ok=True)
    (PUBLIC / "img").mkdir(parents=True, exist_ok=True)
    with_photos = 0
    for rc in races:
        cands, files = rc["candidates"], {}
        ok = all(c["_photo"] for c in cands)
        if ok:
            for c in cands:
                dest = PHOTOS / f"{slug(rc['state'])}-{slug(c['name'])}.jpg"
                if not fetch_photo(c["_photo"]["file"], dest):
                    problems.append(f"photo download failed: {c['name']} ({c['_photo']['file']})")
                    ok = False
                    break
                files[c["name"]] = dest
        with_photos += ok
        for c in cands:
            p = c.pop("_photo")
            if ok:
                shutil.copy2(files[c["name"]], PUBLIC / "img" / files[c["name"]].name)
                c["photo"] = f"/img/{files[c['name']].name}"
                c["credit"] = f"{(p.get('author') or 'Unknown author').strip()}, {p['license'].strip()}, Wikimedia Commons"
            else:
                c["photo"] = c["credit"] = None
    return with_photos


def copy_flags(problems):
    cache, out = PHOTOS / "flags", PUBLIC / "flags"
    cache.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    copied = 0
    for state, code in STATE_CODES.items():
        dest = cache / f"us-{code}.png"
        if not (dest.exists() and dest.stat().st_size > 200):
            url = ("https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Washington,_D.C..svg?width=80" if code == "dc"  # not on flagcdn
                   else f"https://flagcdn.com/w80/us-{code}.png")
            status, ctype = curl_image(url, dest)
            if status != "200" or not ctype.startswith("image/png"):
                dest.unlink(missing_ok=True)
                problems.append(f"flag missing: {state} (HTTP {status})")
                continue
        shutil.copy2(dest, out / dest.name)
        copied += 1
    return copied


def download(url, dest):
    tmp = dest.with_suffix(".part")
    r = subprocess.run(["curl", "-fsSL", "--max-time", "180", "-A", UA, "-o", str(tmp), url], capture_output=True, text=True)
    if r.returncode != 0:
        tmp.unlink(missing_ok=True)
        sys.exit(f"download failed: {url} ({r.stderr.strip()})")
    tmp.rename(dest)


def build_zip_shards():
    """ZIP -> state lookup split by first digit. A ZIP whose area crosses a state line
    keeps every state holding at least a quarter of it; smaller slivers are ignored."""
    src = ROOT / "data-src" / "zcta520_county20.txt"
    src.parent.mkdir(exist_ok=True)
    if not src.exists():
        download(ZCTA_URL, src)
    rows = src.read_text(encoding="utf-8-sig").splitlines()
    head = rows[0].split("|")
    iz, ic, ia = head.index("GEOID_ZCTA5_20"), head.index("GEOID_COUNTY_20"), head.index("AREALAND_PART")
    area = defaultdict(Counter)
    for line in rows[1:]:
        f = line.split("|")
        zcta, county = f[iz], f[ic]
        if zcta and county and county[:2] in FIPS:
            area[zcta][FIPS[county[:2]]] += int(f[ia] or 0) + 1
    cd_file = ROOT / "data-src" / "zcta_cd2026.json"  # made by prep_districts.py
    districts = json.loads(cd_file.read_text()) if cd_file.exists() else {}
    zips, prefixes = {}, defaultdict(Counter)
    for zcta, parts in area.items():
        total = sum(parts.values())
        ranked = parts.most_common()
        states = [st for st, a in ranked if a / total >= 0.25]
        zips[zcta] = states[0] if len(states) == 1 else states
        prefixes[zcta[:3]][ranked[0][0]] += 1
    out = PUBLIC / "data" / "zip"
    out.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1()
    for d in "0123456789":
        shard = json.dumps({
            "zips": {z: v for z, v in sorted(zips.items()) if z[0] == d},
            "prefixes": {p: c.most_common(1)[0][0] for p, c in sorted(prefixes.items()) if p[0] == d},
            "cd": {z: v[0] if len(v) == 1 else v for z, v in sorted(districts.items()) if z[0] == d and z in zips},
        }, separators=(",", ":"))
        (out / f"{d}.json").write_text(shard)
        digest.update(shard.encode())
    multi = sum(isinstance(v, list) for v in zips.values())
    return digest.hexdigest()[:10], len(zips), multi, sum(z in zips for z in districts)


def write_credits(problems):
    """Renders /credits from data-src/credits.json, which load_db.py writes from the portraits it loads."""
    src = ROOT / "data-src" / "credits.json"
    if not src.exists():
        problems.append("data-src/credits.json is missing (run load_db.py --dry-run to write it); /credits not built")
        return 0
    rows = json.loads(src.read_text())
    official = sorted({r["name"] for r in rows if r["kind"] == "official"}, key=lambda n: n.split()[-1])
    commons = [r for r in rows if r["kind"] != "official"]
    esc = lambda t: str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    html = (ROOT / "web" / "credits.src.html").read_text()
    for marker, value in (("__OFFICIAL_COUNT__", str(len(official))), ("__COMMONS_COUNT__", str(len(commons))),
                          ("__OFFICIAL__", "".join(f"<li>{esc(n)}</li>" for n in official)),
                          ("__COMMONS__", "".join(f'<li><b>{esc(r["name"])}</b>, {esc(r["race"])}, {esc(r["state"])}. {esc(r["credit"])}. '
                                                 f'<a href="{esc(r["source"])}" target="_blank" rel="noopener">File page ↗</a></li>' for r in commons))):
        assert marker in html, marker
        html = html.replace(marker, value)
    (PUBLIC / "credits.html").write_text(html)
    return len(rows)


TERMS_LANGS = {"en": "English", "es": "Español", "pt": "Português", "zh": "简体中文", "ru": "Русский"}


def write_terms():
    """Renders /terms and /terms-<lang> from web/terms.content.json into the frame of web/terms.src.html."""
    content = json.loads((ROOT / "web" / "terms.content.json").read_text())
    frame = (ROOT / "web" / "terms.src.html").read_text()
    for marker in ("__LANG__", "__TITLE__", "__SWITCH__", "__BODY__", "__BACK__"):
        assert marker in frame, marker
    links = content["_links"]
    tags = {"lead": '<p class="lead">{}</p>', "h2": "<h2>{}</h2>", "h3": "<h3>{}</h3>", "p": "<p>{}</p>"}
    for lang, name in TERMS_LANGS.items():
        page = content[lang]
        path = lambda l: "/terms" if l == "en" else f"/terms-{l}"
        switch = " · ".join(f'<b>{n}</b>' if l == lang else f'<a href="{path(l)}" hreflang="{l}">{n}</a>' for l, n in TERMS_LANGS.items())
        body = [f"<h1>{page['title']}</h1>", f'<p class="upd">{page["updated"]}</p>']
        if page["note"]:
            body.append(f'<p class="upd">{page["note"]}</p>')
        body += [tags[kind].format(text.format(**links)) for kind, text in page["blocks"]]
        html = (frame.replace("__LANG__", "zh-Hans" if lang == "zh" else lang).replace("__TITLE__", f"{page['title']} · VibeVote")
                .replace("__SWITCH__", switch).replace("__BODY__", "\n".join(body)).replace("__BACK__", page["back"]))
        (PUBLIC / ("terms.html" if lang == "en" else f"terms-{lang}.html")).write_text(html)
    return len(TERMS_LANGS)


def main():
    problems = []
    flags = copy_flags(problems)
    (PUBLIC / "data" / "ballot.json").unlink(missing_ok=True)  # candidate data is served from D1 now
    shutil.rmtree(PUBLIC / "data" / "house", ignore_errors=True)
    src = SRC.read_text()
    if ZIP_MARKER not in src:
        sys.exit(f"{SRC.name} is missing {ZIP_MARKER}")
    zip_version, zip_count, zip_multi, zip_districts = build_zip_shards()
    (PUBLIC / "index.html").write_text(src.replace(ZIP_MARKER, zip_version))
    terms = write_terms()
    credits = write_credits(problems)
    for asset in ("favicon.svg", "favicon-32.png", "favicon-192.png", "apple-touch-icon.png", "mark.svg"):
        shutil.copy2(ROOT / "web" / asset, PUBLIC / asset)
    size = sum(f.stat().st_size for f in PUBLIC.rglob("*") if f.is_file())
    print(f"flags {flags} · zip codes {zip_count} · crossing a state line {zip_multi} · with a 2026 district {zip_districts}")
    print(f"public/ {size / 1e6:.2f} MB · index.html {(PUBLIC / 'index.html').stat().st_size / 1e3:.0f} KB · photo credits {credits} · terms pages {terms}")
    for p in problems:
        print("!", p)


if __name__ == "__main__":
    main()
