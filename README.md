# beacn-drep-web

Static, auditable web layer for BEACN DRep transparency.

This repo does not decide votes.
It only publishes deterministic outputs derived from:
- `beacn-drep-core` decision artifacts
- `beacn-drep-resources` governance datasets

## Outputs
- `data/output/public/backtest_votes.csv`
- `data/output/public/backtest_votes.json`
- `data/output/public/backtest_manifest.json`

## Build
```bash
./scripts/build_backtest.sh
```
