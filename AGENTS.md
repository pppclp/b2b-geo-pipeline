# B2B GEO Pipeline — Agent Guidelines

## Project
React + Vite frontend (`src/`) hosted on GitHub Pages. The shared backend
(`server/core.js`) runs in local Node (`server/api.js`) and on Google Apps Script
(`apps-script/Main.js`). Workbook schema, field mapping, and role scopes are
defined in `b2b_geo_pipeline.yaml`.

Read `README.md` before editing. Do not use Base44 SDK, CLI, or deploy flows.

## Development
- Node 20+; `npm ci` then `npm run dev` for local development.
- Local spreadsheet fixtures are in the gitignored `data/` directory.
- Do not commit UAT credentials, secrets, `.env.local`, or downloaded data.
- After code changes run `npm run lint`, `npm run build`,
  and `node --test tests/*.test.mjs`.
- For backend changes, add regression tests and preserve existing Sheet schemas,
  role scope, audit history and business rules unless specifically instructed.

## Two separate deployments
1. Frontend: GitHub Pages deploy via the repository GitHub Actions workflow
   after reviewed changes merge to `main`.
2. Backend: `npm run gas:build` creates generated Apps Script code;
   `npm run gas:push` requires authorized clasp credentials. In the existing
   Apps Script project, publish a **new version of the existing deployment**.
   Merging frontend code does not deploy backend changes.

Check Script Properties `GEO_SHEET_ID_*` point to the intended source Sheets;
use `debugB2bSheetBindings()` and the smoke tests documented in README.
Never run migrations or backfills against UAT without approved backups.

## UAT safety
- Use role-scoped backend authorization, signed sessions and conditional
  revisions (`expected_updated_at`).
- Create retries use stable `client_request_id` on normal user-created Pipelines;
  imports use their own batch identity.
- Preserve opportunity Stage, Handler, and Working With as separate concepts.
- Do not assume GitHub Actions success verifies the deployed Apps Script runtime.
