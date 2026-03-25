#!/usr/bin/env python3
import csv
import json
import hashlib
from collections import Counter, defaultdict
from pathlib import Path
from datetime import datetime, timezone

WS = Path('/home/ubuntudesktop/.openclaw/workspace')
CORE_OUT = WS / 'beacn-drep-core' / 'data' / 'output'
RES_GOV = WS / 'beacn-drep-resources' / 'data' / 'input' / 'governance'
RES_DREP = WS / 'beacn-drep-resources' / 'data' / 'input' / 'drep'
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
    latest_by_action = {}
    if not CORE_OUT.exists():
        return []
    for run_dir in sorted(CORE_OUT.iterdir()):
        if not run_dir.is_dir():
            continue
        rj = run_dir / 'rationale.json'
        if not rj.exists():
            continue
        data = json.loads(rj.read_text(encoding='utf-8'))
        action_id = data.get('action_id')
        if not action_id:
            continue
        row = {
            'run_id': run_dir.name,
            'action_id': action_id,
            'bot_recommendation': data.get('recommendation'),
            'bot_confidence': data.get('confidence', ''),
            'bot_score': data.get('score', ''),
            'explain_hash': hashlib.sha256(json.dumps(data, sort_keys=True).encode('utf-8')).hexdigest(),
            'soul_commit': data.get('soul_commit', ''),
            'resource_registry_commit': data.get('resource_registry_commit', ''),
            'input_hash': data.get('input_hash', ''),
            'snapshot_bundle_hash': data.get('snapshot_bundle_hash', ''),
        }
        # keep deterministically latest by lexical run_id
        if action_id not in latest_by_action or row['run_id'] > latest_by_action[action_id]['run_id']:
            latest_by_action[action_id] = row
    return list(latest_by_action.values())


def network_majority(a: dict) -> str:
    vals = {
        'YES': float(a.get('drep_yes_pct') or 0),
        'NO': float(a.get('drep_no_pct') or 0),
        'ABSTAIN': float(a.get('drep_abstain_pct') or 0),
    }
    if vals['YES'] == vals['NO'] == vals['ABSTAIN'] == 0:
        return 'UNKNOWN'
    return max(vals, key=vals.get)


def load_top_drep_votes():
    p = RES_DREP / 'top_drep_votes.csv'
    if not p.exists():
        return []
    return load_csv(p)


def top_n_summary(rows: list[dict], n: int = 10):
    if not rows:
        return {}, {}
    by_action = defaultdict(list)
    for r in rows:
        by_action[r.get('action_id')].append(r)

    top_vote = {}
    agreement = {}
    for aid, votes in by_action.items():
        votes2 = sorted(votes, key=lambda x: float(x.get('voting_power') or 0), reverse=True)[:n]
        c = Counter((v.get('vote') or '').upper() for v in votes2)
        top_vote[aid] = c.most_common(1)[0][0] if c else 'UNKNOWN'
        agreement[aid] = dict(c)
    return top_vote, agreement


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    actions = load_csv(RES_GOV / 'governance_actions_all.csv') if (RES_GOV / 'governance_actions_all.csv').exists() else []
    actions_idx = {r.get('action_id'): r for r in actions}
    bot = load_core_rationales()
    top_rows = load_top_drep_votes()
    top_vote_idx, top_counts_idx = top_n_summary(top_rows, n=10)

    table = []
    for b in bot:
        if b['action_id'] not in actions_idx:
            continue
        a = actions_idx.get(b['action_id'], {})
        net = network_majority(a)
        net_agreement = 'aligned' if b['bot_recommendation'] == net else ('unknown' if net == 'UNKNOWN' else 'diverged')

        top_majority = top_vote_idx.get(b['action_id'], 'UNKNOWN')
        top_agreement = 'aligned' if b['bot_recommendation'] == top_majority else ('unknown' if top_majority == 'UNKNOWN' else 'diverged')

        row = {
            'action_id': b['action_id'],
            'run_id': b['run_id'],
            'action_type': a.get('action_type', ''),
            'status': a.get('status', ''),
            'proposed_epoch': a.get('proposed_epoch', ''),
            'expiration_epoch': a.get('expiration_epoch', ''),
            'bot_recommendation': b['bot_recommendation'],
            'bot_score': b['bot_score'],
            'bot_confidence': b['bot_confidence'],
            'network_majority': net,
            'network_agreement': net_agreement,
            'top10_majority': top_majority,
            'top10_agreement': top_agreement,
            'actual_drep_yes_pct': a.get('drep_yes_pct', ''),
            'actual_drep_no_pct': a.get('drep_no_pct', ''),
            'actual_drep_abstain_pct': a.get('drep_abstain_pct', ''),
            'top10_vote_counts_json': json.dumps(top_counts_idx.get(b['action_id'], {}), sort_keys=True),
            'explain_hash': b['explain_hash'],
            'input_hash': b['input_hash'],
            'snapshot_bundle_hash': b['snapshot_bundle_hash'],
            'soul_commit': b['soul_commit'],
            'resource_registry_commit': b['resource_registry_commit'],
            'anchor_url': a.get('anchor_url', ''),
        }
        table.append(row)

    fields = [
        'action_id', 'run_id', 'action_type', 'status', 'proposed_epoch', 'expiration_epoch',
        'bot_recommendation', 'bot_score', 'bot_confidence',
        'network_majority', 'network_agreement', 'top10_majority', 'top10_agreement',
        'actual_drep_yes_pct', 'actual_drep_no_pct', 'actual_drep_abstain_pct',
        'top10_vote_counts_json', 'explain_hash', 'input_hash', 'snapshot_bundle_hash',
        'soul_commit', 'resource_registry_commit', 'anchor_url'
    ]

    csv_path = OUT / 'backtest_votes.csv'
    with csv_path.open('w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in table:
            w.writerow(r)

    json_path = OUT / 'backtest_votes.json'
    json_path.write_text(json.dumps(table, indent=2) + '\n', encoding='utf-8')

    summary = {
        'rows': len(table),
        'network_aligned': sum(1 for r in table if r['network_agreement'] == 'aligned'),
        'network_diverged': sum(1 for r in table if r['network_agreement'] == 'diverged'),
        'top10_aligned': sum(1 for r in table if r['top10_agreement'] == 'aligned'),
        'top10_diverged': sum(1 for r in table if r['top10_agreement'] == 'diverged'),
    }

    summary_path = OUT / 'backtest_summary.json'
    summary_path.write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')

    manifest = {
        'generated_at_utc': datetime.now(timezone.utc).isoformat(),
        'inputs': {
            'core_output_dir': str(CORE_OUT),
            'resources_governance_dir': str(RES_GOV),
            'resources_drep_dir': str(RES_DREP),
            'resources_actions_hash': sha256_file(RES_GOV / 'governance_actions_all.csv') if (RES_GOV / 'governance_actions_all.csv').exists() else '',
            'resources_top_drep_hash': sha256_file(RES_DREP / 'top_drep_votes.csv') if (RES_DREP / 'top_drep_votes.csv').exists() else '',
        },
        'summary': summary,
        'outputs': [
            {'path': str(csv_path), 'sha256': sha256_file(csv_path)},
            {'path': str(json_path), 'sha256': sha256_file(json_path)},
            {'path': str(summary_path), 'sha256': sha256_file(summary_path)},
        ]
    }
    (OUT / 'backtest_manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f"rows={len(table)}")


if __name__ == '__main__':
    main()
