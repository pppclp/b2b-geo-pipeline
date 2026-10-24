# AGENTS.md — B2B GEO Pipeline

This repository is a React/Vite frontend with a shared Node/Google Apps Script backend.
It is **not** a Base44 app. Work from `README.md` and keep changes tightly scoped.

## Architecture
- `src/`: React frontend and API client. GitHub Pages deploys static `dist/` on changes to `main`.
- `server/core.js`: authoritative business logic shared by local API and Apps Script.
- `server/api.js`: local development server.
- `apps-script/Main.js`: Google Apps Script entry point / Google Sheets transport.
- `b2b_geo_pipeline.yaml`: Sheet binding, columns, permissions and references.
- `scripts/gas-build.mjs`: generates Apps Script `GeoCore.js`, `Contract.js`, `SheetIds.js`.
- `tests/`: Node test suite. Keep permission and audit changes covered by tests.

## Commands
```bash
npm ci
npm run dev
npm run lint
npm run build
node --test tests/*.test.mjs
npm run gas:build
```
Never use `npm audit fix --force`; review any lockfile changes.

## Deployment (two independent sides)
1. Frontend: merge approved PR to `main`; verify GitHub Pages action and deployed site.
2. Backend: build the matching Apps Script bundle (`npm run gas:build`), update the actual Apps Script project, verify Sheet IDs/Script Properties and publish a new deployment version.
3. Validate that the frontend API URL points to the updated Apps Script deployment. A GitHub Pages deploy does **not** update Apps Script.
4. Before database migrations, verify the exact UAT Sheet ID, create a restricted backup, and use the guarded migration procedure documented in `README.md`.

## Data/Access Safety
- Never commit `.env.local`, UAT passwords, tokens, or private spreadsheet data.
- Never change Google Sheets schema without explicit approval.
- Respect existing AE/SM/Management/Admin permissions and ownership.
- Keep `Pipeline_Events` append-only and preserve optimistic revision checks.
- No unnecessary UX features or scope creep; user-provided business rules are authoritative.
