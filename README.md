# beacn-drep-web

🌐 **Live site:** https://beacnpool.github.io/beacn-drep-web/

Presentation layer for BEACN DRep outputs.

Frontend policy:
- Canonical frontend: root `index.html`, `styles.assessment.css`, `app.assessment.js`, and
  `verify.js` (static, no build step)
- `manifest.json` and `sw.assessment.js` provide installability and offline fallback
- There is exactly one frontend; superseded ones (legacy `app.js`, `site/`, the Next.js
  scaffold) were removed 2026-07-15 and live in git history only

Rules:
- View-only
- No governance decision logic
- No hidden inputs
- Reads public machine-generated JSON artifacts

Expected artifact shape lives in `docs/DATA_SOURCES.md`.

Public decision-boundary contract: `docs/PUBLIC_CONTEXT_AND_LIMITS.md`.
Public operating model: `docs/OPERATING_MODEL.md`.
