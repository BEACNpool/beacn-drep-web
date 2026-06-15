# beacn-drep-web

🌐 **Live site:** https://beacnpool.github.io/beacn-drep-web/

Presentation layer for BEACN DRep outputs.

Frontend policy:
- Canonical frontend: root `index.html`, `styles.css`, and `app.js` (static, no build step)
- `manifest.json` and `sw.js` provide installability and offline feed fallback
- Next.js app scaffolding exists for migration history only and is not the production path

Rules:
- View-only
- No governance decision logic
- No hidden inputs
- Reads public machine-generated JSON artifacts

Expected artifact shape lives in `docs/DATA_SOURCES.md`.

Public decision-boundary contract: `docs/PUBLIC_CONTEXT_AND_LIMITS.md`.
Public operating model: `docs/OPERATING_MODEL.md`.
