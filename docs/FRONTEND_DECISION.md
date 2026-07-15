# Frontend Decision

## Decision
Use a static frontend as the canonical public dashboard: root `index.html` +
`app.assessment.js` + `styles.assessment.css` + `verify.js` (PWA, hash router, no build step).

## Why
- Maximum transparency: anyone can inspect the exact shipped page.
- No build/runtime drift risk from framework tooling.
- Easier reproducibility for auditors — the in-browser verifier depends on it.

## History
- The original static dashboard (`site/index.html`, later root `app.js`/`styles.css`/`sw.js`)
  and the Next.js migration scaffold were removed 2026-07-15; they exist in git history only.
