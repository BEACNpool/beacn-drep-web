#!/usr/bin/env python3
import csv
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

WS = Path(os.environ.get("BEACN_WORKSPACE", Path.home() / ".openclaw" / "workspace"))
RES = WS / "beacn-drep-resources" / "data" / "history" / "drep_votes" / "latest" / "drep_vote_history.csv"
ACT = Path("data/output/public/actions.json")
OUT = Path("data/output/public/drep_comparison.json")


def load_beacn_votes() -> dict[str, str]:
    j = json.loads(ACT.read_text(encoding="utf-8"))
    out = {}
    for it in j.get("items", []):
        aid = it.get("action_id")
        if not aid or str(aid).startswith("ga_"):
            continue
        out[aid] = (it.get("decision") or "").upper()
    return out


def load_latest_drep_votes() -> dict[tuple[str, str], dict]:
    latest = {}
    with RES.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            aid = r.get("action_id", "")
            drep = r.get("drep_id", "")
            if not aid or not drep:
                continue
            key = (aid, drep)
            t = r.get("vote_time_utc", "")
            prev = latest.get(key)
            if not prev or t > prev.get("vote_time_utc", ""):
                latest[key] = r
    return latest


def main() -> None:
    beacn = load_beacn_votes()
    latest = load_latest_drep_votes()

    drep_stats = defaultdict(lambda: {"agreements": 0, "divergences": 0, "unknown": 0, "sample": 0})
    disagreements = []

    for (aid, drep), row in latest.items():
        b = beacn.get(aid)
        if not b:
            continue
        v = (row.get("vote") or "").upper()
        st = drep_stats[drep]
        st["sample"] += 1
        if v == b:
            st["agreements"] += 1
        elif v in ("YES", "NO", "ABSTAIN", "NO_CONFIDENCE"):
            st["divergences"] += 1
            disagreements.append({
                "action_id": aid,
                "drep_id": drep,
                "beacn_vote": b,
                "drep_vote": v,
                "vote_time_utc": row.get("vote_time_utc", ""),
            })
        else:
            st["unknown"] += 1

    ranking = []
    for drep, st in drep_stats.items():
        sample = st["sample"]
        agree_rate = (st["agreements"] / sample) if sample else 0.0
        ranking.append({
            "drep_id": drep,
            "sample": sample,
            "agreements": st["agreements"],
            "divergences": st["divergences"],
            "agreement_rate": round(agree_rate, 4),
        })

    ranking.sort(key=lambda x: (-x["sample"], x["agreement_rate"]))
    disagreements.sort(key=lambda x: x["vote_time_utc"], reverse=True)

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "actions_compared": len(beacn),
        "dreps_compared": len(ranking),
        "total_latest_votes_compared": sum(r["sample"] for r in ranking),
        "top_dreps_by_sample": ranking[:25],
        "latest_disagreements": disagreements[:200],
    }

    OUT.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"out": str(OUT), "dreps": len(ranking), "votes": summary["total_latest_votes_compared"]}))


if __name__ == "__main__":
    main()
