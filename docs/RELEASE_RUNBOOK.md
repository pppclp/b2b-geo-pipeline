# B2B GEO Pipeline — Release Runbook (UAT → Production Gate)

**Authoritative runbook for the current Toggle-only release.** Previous Phase 4 ticket migration and support claim/resolve instructions are obsolete. **No code merge or GitHub Pages success is a Production approval.**

## Freeze and inventory
1. Freeze feature scope: Pipeline, role-scoped List/Board, Working With team metadata, Needs Support **Pipeline toggle**, import, events and snapshots. Do **not** recreate Support Requests.
2. Record a Git tag for the **approved** frontend commit and its matching generated Apps Script Code.gs bundle, deployment version, deployed /exec URL (restricted release evidence only), current Sheet schema version, and responsible release owner.
3. Review the public repo for hard-coded workbook IDs/secrets. Never commit workbook IDs or customer/credential data. Removing an ID from HEAD does not erase Git history; Security decides whether to rotate IDs and restrict shares.
4. Before a release, generate the Apps Script bundle with `npm run gas:build` and push the exact verified build to the **existing** Apps Script project. Never paste `apps-script/Main.js` alone.
5. Disable automatic GitHub Pages release from arbitrary main changes. The Pages workflow requires a manual `backend_verified` confirmation only **after** the coordinated backend deployment is validated.

## Read-only source & security preflight
- Confirm approved UAT-only data and four role accounts. Production requires organization-approved identity (SSO/MFA or approved equivalent), hosting/API exposure, secrets, retention/privacy policy and sign-off.
- Using authorized editor access, verify Script Properties and workbook bindings from the **existing** project without logging IDs or row data. Existing runtime helpers in `apps-script/Main.js` include `debugB2bSheetBindings()`, `debugUatLoginReadiness()`, and `debugPipelineDbBinding()` (verify exact helper names in the build). Do not run retired `bindCurrentPipelineSources()` or `diagnoseMockPipelineVisibility()` unless independently verified in your deployed source.
- Confirm essential DB tabs and headers; missing tabs must fail closed with `REQUIRED_SHEET_MISSING` / `SCHEMA_MISMATCH`. No `setup()` or destructive regeneration of the canonical workbook. If the approved Phase-4 sheet preparation is explicitly needed, set the **private** Script Property `GEO_APPROVED_PIPELINE_DB_ID` to the verified live workbook ID under change control; this value must never enter Git. Do not rerun preparation casually.
- Verify the restricted credential store, signed UAT sessions and current policy. UAT temporary passwords are **not** Production auth. Never run `backfillGeoPhase4SupportFlags()` (retired and intentionally throws).

## Business data gate — REQUIRED before customer data
- Business Owner signs off `docs/FINANCIAL_FIELD_SIGNOFF.md` including precise definitions for Net RC, RC, OC, Monthly Sale Plan and Pipeline Value; do not alter the calculation by guessing.
- Confirm imported Business IDs are 13-digit Thai tax/juristic IDs. If other ID types are in scope, formally approve a new typed identifier schema before import. Preserve source text including leading zeroes; never fabricate zeroes.
- Confirm `Industrial` classification in the approved Customer Type taxonomy. Contact Name / Phone may be absent in legacy imports; they must not be auto-filled with fake values.
- Run import dry-run with authorized de-identified representative source files (realistic headers, mixed types, styled blank rows, missing contacts and damaged IDs). No raw customer XLSX in public CI, GitHub issues, logs or PRs.
- Reject entire batches if any row invalid or source Net RC reference differs from the current formula. If no reference exists, reconcile per Region, AE, Category, Status and month in a controlled external report and record sign-off. Preserve import batch identity for safe retries.

## Coordinated deployment
1. Back up **approved test copies** of Pipeline DB and masters in restricted storage. Keep the previous published frontend and Apps Script versions/rollback metadata.
2. Execute lint, node tests and build; ensure all integration/contract/import/security regression gates are green.
3. Deploy the **combined** Apps Script build as a new version of the **existing** /exec deployment; preserve its URL and secrets. Confirm /session/me reports API contract version and required capabilities with a signed test session.
4. Validate AE/SM/Management/Admin Region visibility and that Working With **team metadata does not silently expand AE permissions**. Confirm Pipeline read, write, audit, history, export, support Off→On→Off and stale 409 behavior.
5. Trigger manual GitHub Pages workflow only after the backend is verified. Confirm deployed frontend loads only against a compatible API contract; stale versions must show an error instead of zero Pipeline data.
6. Test errors 401/403/409/428/503, missing sheet, mismatched header, saved-write/failed-refresh, expired login, concurrent writes, idempotent create/import and restore after a simulated interruption.
7. Run representative peak concurrency/load tests against **synthetic/authorized UAT data**; measure lock waits, HTTP error rates, quotas and end-user latency. Increase or change backend capacity only based on measured results.
8. Capture a scheduled month-end Snapshot in a test environment and verify its `Admin_Audit` event has actor `SYSTEM_MONTH_END`, not a human Admin; test duplicate-period skip and failure alerts.
9. Perform backup **and restore** rehearsal to a test copy, compare Pipelines, Events, Snapshots and Admin_Audit counts/checksums; verify rollback of both frontend/backend.

## Production Go/No-Go
Do not enable real customer data until all gates have written evidence: Financial Field Sign-off, Import reconciliation, privacy/security approval, identity/hosting approval, 4-role access tests, concurrent load, recoverability, monitoring/alert owner, and Product/IT/Business go-live approval. Track external blockers in GitHub Issue #69; a healthy CI is not proof of runtime acceptance.

## Rollback
On contract mismatch or serious write error, suspend writes, restore **matching** prior backend/frontend revisions and validate workbook recovery with an authorized operator. Preserve `__GEO_BAK__*` tabs and transaction marker until recovery is verified. Never delete old Support_Requests rows or append-only events.
