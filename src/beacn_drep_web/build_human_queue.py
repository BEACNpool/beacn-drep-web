#!/usr/bin/env python3
import csv
import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

WS = Path(os.environ.get("BEACN_WORKSPACE", Path.home() / ".openclaw" / "workspace"))
CORE = Path("data/output/public/actions.json")
RAT = Path("data/output/public/rationales.json")
DEEP = WS / "beacn-drep-resources" / "data" / "input" / "governance" / "decision_support" / "deep_research_dossiers.csv"
OUT = Path("data/output/public/human_queue.json")

FIELDS = [
    ("proposal_summary_complete", "proposal summary"),
    ("budget_analysis_complete", "budget analysis"),
    ("feasibility_assessment_complete", "execution feasibility"),
    ("risk_analysis_complete", "risk analysis"),
    ("alternatives_analysis_complete", "alternatives analysis"),
    ("failure_mode_analysis_complete", "failure-mode analysis"),
    ("community_impact_complete", "community impact"),
]


def is_yes(v: str) -> bool:
    return (v or "").strip().lower() in ("yes", "true", "1")


def main() -> None:
    actions = json.loads(CORE.read_text(encoding="utf-8")).get("items", [])
    rationales = {x.get("action_id"): x for x in json.loads(RAT.read_text(encoding="utf-8")).get("items", [])}
    by_action = {x.get("action_id"): x for x in actions if x.get("action_id")}

    missing_counter = Counter()
    queue = []

    if DEEP.exists():
        with DEEP.open(newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                aid = r.get("action_id", "")
                if not aid:
                    continue
                act = by_action.get(aid, {})
                if (act.get("decision") or "").upper() != "NEEDS_MORE_INFO":
                    continue
                missing = [label for key, label in FIELDS if not is_yes(r.get(key, ""))]
                for m in missing:
                    missing_counter[m] += 1
                queue.append({
                    "action_id": aid,
                    "action_type": act.get("type", ""),
                    "status": act.get("status", ""),
                    "decision": act.get("decision", ""),
                    "summary": (rationales.get(aid, {}) or {}).get("summary", ""),
                    "missing_sections": missing,
                    "next_step": f"Complete: {', '.join(missing[:3])}" + ("..." if len(missing) > 3 else ""),
                })

    queue.sort(key=lambda x: (len(x.get("missing_sections", [])), x.get("action_id", "")))

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "blocked_count": len(queue),
        "top_missing_sections": [{"section": k, "count": v} for k, v in missing_counter.most_common()],
        "items": queue,
    }
    OUT.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"out": str(OUT), "blocked": len(queue)}))


if __name__ == "__main__":
    main()
