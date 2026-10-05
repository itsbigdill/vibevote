#!/usr/bin/env python3
"""Build data-src/zcta_cd2026.json: the congressional districts (2026 lines) covering each 2020 ZCTA.

Block assignments come from the Census 120th Congress block equivalency file (the lines states
submitted for 2026), except Missouri: its 2025 map is suspended for 2026, so it keeps the 119th
Congress assignments (its 2022 map). Each ZCTA's districts are weighted by 2020 census blocks
(a block split between ZCTAs counts by its share of land area), which follows where people live
far better than land area does.

The script also checks its inputs:
  - states that didn't redraw must have identical 119th and 120th block assignments,
  - Florida and Louisiana must match the block files their legislatures published,
  - Utah must match the court-ordered map published by the Utah Geospatial Resource Center.
Run once; build.py reads the output.
"""
import csv
import io
import json
import subprocess
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from build import FIPS, STATE_CODES, UA

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "data-src"
OUT = SRC / "zcta_cd2026.json"
REL_URL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt"
GAZ_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip"
FL_BEF = "https://edr.state.fl.us/content/redistricting/2026redistricting/EOGPCRP2026.txt"
LA_BEF = ("https://redist.legis.la.gov/2026_Files/Act2Congress/Block%20Equivalency%20File/"
          "Block%20Equlivancy%20File%20-%20Act%202%20(2026%20RS%20-%20Congress).txt")
UT_MAP = ("https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/political_us_congress_districts_2026_to_2032/"
          "FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson")
REDRAWN = {"01", "06", "12", "22", "37", "39", "47", "48", "49"}  # AL CA FL LA NC OH TN TX UT
KEEP_119 = {"29"}  # Missouri
STATE_POSTALS = {code.upper() for code in STATE_CODES.values()}
MIN_SHARE, SOLE_SHARE = 0.05, 0.95


def fetch(url, dest=None):
    cmd = ["curl", "-fsSL", "--max-time", "900", "-A", UA, url]
    if dest:
        subprocess.run(cmd + ["-o", str(dest)], check=True)
        return dest
    return subprocess.run(cmd, check=True, capture_output=True).stdout


def read_bef(zip_path, member):
    with zipfile.ZipFile(zip_path) as z, z.open(member) as f:
        rows = csv.reader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        head = next(rows)
        ig, icd = head.index("GEOID"), head.index("CDFP")
        for row in rows:
            if row[icd].isdigit():  # "ZZ" marks blocks outside any district (water)
                yield row[ig], row[ig][:2], row[icd]  # the block GEOID starts with the state FIPS


def label(code):
    st, cd = divmod(code, 100)
    postal = FIPS.get(f"{st:02d}")
    if postal not in STATE_POSTALS:
        return None
    if postal == "DC":
        return "DC-DEL"
    return f"{postal}-AL" if cd == 0 else f"{postal}-{cd}"


def load_assignments():
    district_of = {}
    for geoid, st, cd in read_bef(SRC / "cd120.zip", "NationalCD120.txt"):
        if st not in KEEP_119:
            district_of[int(geoid)] = int(st) * 100 + int(cd)
    unchanged_diff = Counter()
    for geoid, st, cd in read_bef(SRC / "cd119.zip", "NationalCD119.txt"):
        code = int(st) * 100 + int(cd)
        if st in KEEP_119:
            district_of[int(geoid)] = code
        elif st not in REDRAWN and district_of.get(int(geoid)) != code:
            unchanged_diff[FIPS.get(st, st)] += 1
    return district_of, unchanged_diff


def compare_state_bef(district_of, url, st, sep):
    same = diff = 0
    for line in fetch(url).decode("utf-8-sig").splitlines():
        parts = line.replace('"', "").split(sep) if sep else line.split()
        if len(parts) < 2 or not parts[0].strip().isdigit():
            continue
        geoid, cd = parts[0].strip(), parts[1].strip()
        if not cd.isdigit():
            continue
        if district_of.get(int(geoid)) == int(st) * 100 + int(cd):
            same += 1
        else:
            diff += 1
    return same, diff


def inside(lon, lat, ring):
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def in_polygon(lon, lat, polygon):
    return inside(lon, lat, polygon[0]) and not any(inside(lon, lat, hole) for hole in polygon[1:])


def check_utah(zcta_top):
    geo = json.loads(fetch(UT_MAP))
    feats = geo.get("features") or []
    key = next((k for k in (feats[0]["properties"] if feats else {})
                if {str(f["properties"].get(k)) for f in feats} == {"1", "2", "3", "4"}), None)
    if not key:
        return f"Utah check skipped: no district field in {list(feats[0]['properties']) if feats else 'empty layer'}"
    shapes = []
    for f in feats:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        shapes.append((int(f["properties"][key]), polys))
    with zipfile.ZipFile(io.BytesIO(fetch(GAZ_URL))) as z:
        text = z.read(z.namelist()[0]).decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text), delimiter="\t"))
    head = [h.strip() for h in rows[0]]
    ig, ilat, ilon = head.index("GEOID"), head.index("INTPTLAT"), head.index("INTPTLONG")
    agree = total = 0
    for row in rows[1:]:
        zcta = row[ig].strip()
        top = zcta_top.get(zcta)
        if not top or not top.startswith("UT-"):
            continue
        lat, lon = float(row[ilat]), float(row[ilon])
        found = next((d for d, polys in shapes if any(in_polygon(lon, lat, p) for p in polys)), None)
        if found is None:
            continue
        total += 1
        agree += top == f"UT-{found}"
    return f"Utah court map vs Census file: {agree}/{total} ZIP centres agree"


def main():
    print("loading block assignments…", flush=True)
    district_of, unchanged_diff = load_assignments()
    print(f"  {len(district_of):,} blocks; unchanged states differing from 119th: {dict(unchanged_diff) or 'none'}", flush=True)
    for name, url, st, sep in (("Florida", FL_BEF, "12", ","), ("Louisiana", LA_BEF, "22", None)):
        try:
            same, diff = compare_state_bef(district_of, url, st, sep)
            print(f"  {name} legislature file vs Census: {same:,} blocks agree, {diff:,} differ", flush=True)
        except Exception as e:
            print(f"  {name} check failed: {e}", flush=True)

    print("streaming ZCTA-to-block relationships (~1 GB)…", flush=True)
    weights = defaultdict(Counter)
    proc = subprocess.Popen(["curl", "-fsSL", "--max-time", "3600", "-A", UA, REL_URL], stdout=subprocess.PIPE)
    lines = 0
    for line in io.TextIOWrapper(proc.stdout, encoding="utf-8-sig"):
        lines += 1
        f = line.rstrip("\n").split("|")
        if len(f) < 17 or not f[1] or not f[9] or not f[9].isdigit():
            continue
        block_land, part_land = int(f[11] or 0), int(f[15] or 0)
        if block_land <= 0 or part_land <= 0:
            continue
        code = district_of.get(int(f[9]))
        if code is not None:
            weights[f[1]][code] += part_land / block_land
        if lines % 2_000_000 == 0:
            print(f"  {lines:,} lines", flush=True)
    if proc.wait() != 0:
        sys.exit("download of the relationship file failed")

    out, split = {}, 0
    for zcta, w in weights.items():
        total = sum(w.values())
        ranked = [(label(c), v / total) for c, v in w.most_common()]
        ranked = [(d, share) for d, share in ranked if d]
        if not ranked:
            continue
        keep = ranked[:1] if ranked[0][1] >= SOLE_SHARE else [(d, s) for d, s in ranked if s >= MIN_SHARE]
        out[zcta] = [d for d, _ in keep]
        split += len(keep) > 1
    OUT.write_text(json.dumps(out, separators=(",", ":"), sort_keys=True))
    print(f"wrote {OUT.name}: {len(out):,} ZIP codes, {split:,} covering more than one district", flush=True)
    try:
        print(" ", check_utah({z: d[0] for z, d in out.items()}), flush=True)
    except Exception as e:
        print(f"  Utah check failed: {e}", flush=True)


if __name__ == "__main__":
    main()
