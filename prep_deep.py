#!/usr/bin/env python3
"""Prepare the second, deeper research pass for candidates who can't be matched yet.

A candidate needs scores on at least 3 of the matchable topics (every topic except liberty).
Writes profiles/deep_in/dNNN.json batches of 8, major-party nominees first; research agents
write the improved profiles to profiles/deep/dNNN.json, which load_db.py prefers.
"""
import json
from pathlib import Path

from build import DOMAINS, slug
from prep_profiles import load_candidates

ROOT = Path(__file__).resolve().parent
PROFILES = ROOT / "profiles"
OUT = PROFILES / "deep_in"
MATCH = [d for d in DOMAINS if d != "liberty"]
BATCH = 8


def scored(profile, d):
    pos = (profile.get("positions") or {}).get(d)
    return isinstance(pos, dict) and isinstance(pos.get("score"), (int, float))


def main():
    inputs = {x["id"]: x for f in sorted((PROFILES / "in").glob("b*.json")) for x in json.loads(f.read_text())}
    current = {p["id"]: p for f in sorted((PROFILES / "out").glob("b*.json")) for p in json.loads(f.read_text())}
    targets, seen = [], set()
    for rc, rid, label, c in load_candidates():
        cid = f"{rid}/{slug(c['name'])}"
        if cid in seen or cid not in inputs:
            continue
        seen.add(cid)
        prof = current.get(cid, {})
        if sum(scored(prof, d) for d in MATCH) >= 3:
            continue
        item = inputs[cid]
        targets.append({
            "id": cid,
            "name": prof.get("name") or c["name"],
            "party": prof.get("party") or c["party"],
            "race": rid,
            "race_label": label,
            "race_status": rc.get("status", "Nominees set"),
            "incumbent": item["incumbent"],
            "member_of_congress": item["member_of_congress"],
            "missing_topics": [d for d in DOMAINS if not scored(prof, d)],
            "profile": prof,
        })
    major = ("Democratic", "Republican")
    targets.sort(key=lambda t: (t["party"] not in major, t["race"]))
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("d*.json"):
        old.unlink()
    batches = [targets[i:i + BATCH] for i in range(0, len(targets), BATCH)]
    for n, batch in enumerate(batches, 1):
        (OUT / f"d{n:03d}.json").write_text(json.dumps(batch, ensure_ascii=False, indent=1))
    labels = [f"{b[0]['race']} … {b[-1]['race']}" for b in batches]
    (OUT / "_batches.json").write_text(json.dumps(labels, ensure_ascii=False))
    print(f"targets {len(targets)} · major party {sum(t['party'] in major for t in targets)} · batches {len(batches)}")
    print(json.dumps(labels, ensure_ascii=False))


if __name__ == "__main__":
    main()
