#!/usr/bin/env python3
import csv
import json
import hashlib
from pathlib import Path
from datetime import datetime, timezone

WS = Path('/home/ubuntudesktop/.openclaw/workspace')
CORE_OUT = WS / 'beacn-drep-core' / 'data' / 'output'
RES_GOV = WS / 'beacn-drep-resources' / 'data' / 'input' / 'governance'
OUT = Path('data/output/public')


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def load_csv(path: Path):
    with path.open(newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def load_core_rationales():
    rows = []
    if not CORE_OUT.exists():
        return rows
    for run_dir in sorted(CORE_OUT.iterdir()):
        if not run_dir.is_dir():
            continue
        rj = run_dir / 'rationale.json'
        if not rj.exists():
            continue
        data = json.loads(rj.read_text(encoding='utf-8'))
        rows.append({
            'run_id': run_dir.name,
            'action_id': data.get('action_id'),
            'bot_recommendation': data.get('recommendation'),
            'bot_confidence': '',
            'bot_score': '',
            'explain_hash': hashlib.sha256(json.dumps(data, sort_keys=True).encode('utf-8')).hexdigest(),
            'soul_commit': data.get('soul_commit',''),
            'resource_registry_commit': data.get('resource_registry_commit',''),
            'input_hash': data.get('input_hash',''),
            'snapshot_bundle_hash': data.get('snapshot_bundle_hash',''),
        })
    return rows


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    actions = load_csv(RES_GOV / 'governance_actions_all.csv') if (RES_GOV / 'governance_actions_all.csv').exists() else []
    actions_idx = {r.get('action_id'): r for r in actions}
    bot = load_core_rationales()

    table = []
    for b in bot:
        a = actions_idx.get(b['action_id'], {})
        row = {
            'action_id': b['action_id'],
            'run_id': b['run_id'],
            'action_type': a.get('action_type',''),
            'status': a.get('status',''),
            'proposed_epoch': a.get('proposed_epoch',''),
            'expiration_epoch': a.get('expiration_epoch',''),
            'bot_recommendation': b['bot_recommendation'],
            'bot_score': b['bot_score'],
            'bot_confidence': b['bot_confidence'],
            'actual_drep_yes_pct': a.get('drep_yes_pct',''),
            'actual_drep_no_pct': a.get('drep_no_pct',''),
            'actual_drep_abstain_pct': a.get('drep_abstain_pct',''),
            'agreement_label': '',
            'explain_hash': b['explain_hash'],
            'input_hash': b['input_hash'],
            'snapshot_bundle_hash': b['snapshot_bundle_hash'],
            'soul_commit': b['soul_commit'],
            'resource_registry_commit': b['resource_registry_commit'],
            'anchor_url': a.get('anchor_url',''),
        }
        table.append(row)

    fields = [
        'action_id','run_id','action_type','status','proposed_epoch','expiration_epoch',
        'bot_recommendation','bot_score','bot_confidence',
        'actual_drep_yes_pct','actual_drep_no_pct','actual_drep_abstain_pct',
        'agreement_label','explain_hash','input_hash','snapshot_bundle_hash',
        'soul_commit','resource_registry_commit','anchor_url'
    ]

    csv_path = OUT / 'backtest_votes.csv'
    with csv_path.open('w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in table:
            w.writerow(r)

    json_path = OUT / 'backtest_votes.json'
    json_path.write_text(json.dumps(table, indent=2) + '\n', encoding='utf-8')

    manifest = {
        'generated_at_utc': datetime.now(timezone.utc).isoformat(),
        'inputs': {
            'core_output_dir': str(CORE_OUT),
            'resources_governance_dir': str(RES_GOV),
            'resources_actions_hash': sha256_file(RES_GOV / 'governance_actions_all.csv') if (RES_GOV / 'governance_actions_all.csv').exists() else '',
        },
        'row_count': len(table),
        'outputs': [
            {'path': str(csv_path), 'sha256': sha256_file(csv_path)},
            {'path': str(json_path), 'sha256': sha256_file(json_path)},
        ]
    }
    (OUT / 'backtest_manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f"rows={len(table)}")


if __name__ == '__main__':
    main()
