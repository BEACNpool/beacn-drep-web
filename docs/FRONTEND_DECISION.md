# Frontend Decision

## Decision
Use a static frontend (`site/index.html`) as the canonical public dashboard.

## Why
- Maximum transparency: anyone can inspect the exact shipped page.
- No build/runtime drift risk from framework tooling.
- Easier reproducibility for auditors.

## Status of Next.js files
Historical scaffolding remains in-repo for now but is non-canonical and should not be used for production deployment.

## Follow-up
- Remove stale framework files after content parity checklist is complete.
- Keep all critical transparency views in static HTML/JS.
