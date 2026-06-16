#!/usr/bin/env python3
"""Build the lightweight landing-page status feed from canonical artifacts."""
from __future__ import annotations

import csv
import json
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = Path(os.environ.get("BEACN_WORKSPACE", ROOT.parent))
RESOURCES = WORKSPACE / "beacn-drep-resources"
CORE = WORKSPACE / "beacn-drep-core"
ACTIVE_CSV = RESOURCES / "data/input/governance/governance_actions_active.csv"
PUBLIC_ACTIONS = CORE / "data/output/public/actions"
OUTPUT = ROOT / "status.json"

DREP_ID = "drep1yg3fzjm63hjg37k3rtdt7wx0mgmn303lwv2s50xxkjzsv5qfhynxg"
CARDANO_START = datetime(2017, 9, 23, 21, 44, 51, tzinfo=timezone.utc)
EPOCH_SECONDS = 5 * 24 * 60 * 60


def main() -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    epoch = int((now - CARDANO_START).total_seconds() // EPOCH_SECONDS)
    with ACTIVE_CSV.open(newline="", encoding="utf-8") as handle:
        active = list(csv.DictReader(handle))

    actions = []
    votes_cast = 0
    for row in sorted(active, key=lambda item: int(item["proposed_epoch"]), reverse=True):
        detail_path = PUBLIC_ACTIONS / f"{row['action_id']}.json"
        detail = json.loads(detail_path.read_text(encoding="utf-8"))
        decision = detail.get("decision", {})
        submitted = bool(decision.get("submitted"))
        if submitted:
            votes_cast += 1
        actions.append({
            "action_id": f"{row['tx_hash']}#{row['cert_index']}",
            "cip129_action_id": row["action_id"],
            "title": row.get("metadata_title", ""),
            "type": row["action_type"],
            "proposed_in_epoch": int(row["proposed_epoch"]),
            "expires_after_epoch": int(row["expiration_epoch"]),
            "status": "open",
            "recommendation": decision.get("vote"),
            "our_vote": decision.get("vote") if submitted else None,
            "transaction_hash": decision.get("transaction_hash"),
            "submitted_at": decision.get("submitted_at"),
            "rationale_url": detail.get("proof_of_vote", {}).get("rationale_anchor_url"),
            "anchor_url": row.get("anchor_url", ""),
        })

    generated_at = now.isoformat()
    output = {
        "generated_at": generated_at,
        "drep_id": DREP_ID,
        "mode": "live",
        "last_check": {
            "at": generated_at,
            "epoch": epoch,
            "open_actions": len(actions),
            "actions_with_our_vote": votes_cast,
            "summary": (
                f"Epoch {epoch}: {len(actions)} active governance actions; "
                f"{votes_cast} confirmed on-chain vote(s), "
                f"{len(actions) - votes_cast} held pending sufficient evidence."
            ),
        },
        "actions": actions,
        "note": "Generated from the admitted resources snapshot and published core vote receipts.",
    }
    OUTPUT.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "epoch": epoch,
        "open_actions": len(actions),
        "actions_with_our_vote": votes_cast,
    }))


if __name__ == "__main__":
    main()
