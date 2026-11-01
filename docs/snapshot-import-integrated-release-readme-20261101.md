# Integrated release plan — Snapshot Repair + Historical Migration (2026-11-01)

**Status: Draft PR #155. No merge, no deployment, no Production import.**

## Why single integrated Code.gs
A standalone Apps Script bundle from Snapshot PR #151 does not contain the import fixes. A standalone bundle from Historical Import PR #153 does not contain the new Snapshot physical routing. Only the integration branch combines both. Never copy-paste or deploy separate old Code.gs bundles on top of each other.

## Verified source-state reference (read-only)
- Current live Production inspection: 166 Pipelines, 131 historical source IDs, 35 with no import source ID.
- Offline full scope: 416 original candidate lines - 4 approved blank BMA-West rows = 412.
- Latest static reconciliation: 122 ALREADY_IMPORTED, 1 potential WebApp duplicate, 210 DATA_HOLD, 79 static PREVIEW_CANDIDATE (NOT authenticated Backend READY).
- Three legacy Source ID aliases collision among six physically distinct Excel rows. Canonical `source_workbook` + `source_sheet="Pipeline"` + `source_row` is required to give those six separate technical identities.
- No current Production write, auth session, live Preview/Commit or run of any manual setup function has been made by these PRs.

## Proposed manual sequence (authorization and backups mandatory)
1. Back up **both** active Pipeline DB and new Regional Reporting workbook and confirm exact spreadsheet identity; preserve separate existing Config, User Org Master and Credentials.
2. Use the integrated GitHub Actions **Build Copy-Paste Code.gs** artifact from this exact PR head once verify/build workflows pass. Do not use older builds.
3. Confirm signed session and roles are unchanged in the generated build. Keep all existing Script Properties. Set only the new Reporting workbook key `GEO_SHEET_ID_B2B_GEO_Regional_Reporting_Snapshots` to the verified reporting spreadsheet ID.
4. In the **existing** Apps Script project, install the integrated Code.gs source but do not deploy a new web-app version yet. Run `debugB2bSheetBindings` and `debugPipelineDbBinding` (read only).
5. After backup and authorization, run `prepareGeoRegionalSnapshotSchema()`: create/validate one canonical technical `Snapshots` tab with 50 source/identity columns in the reporting workbook. Existing eight 30-column regional tabs remain unchanged.
6. After independent backup and explicit schema approval (`GEO_APPROVED_PIPELINE_DB_ID` verified and `GEO_HISTORICAL_IMPORT_SCHEMA_APPROVED=YES`), run `prepareGeoHistoricalImportColumns()`: add **14** provenance columns to `Pipelines` header only. Never rewrite old Pipeline, Events or Audit data.
7. Run `debugGeoRegionalSnapshotBinding()`, `debugGeoHistoricalImportSchema()`, `debugGeoPipelineDataIntegrity()`. Confirm counts/integrity before deployment.
8. Release a **new version of the same** Apps Script Web App deployment, keeping its existing /exec URL. Verify `GEO_RELEASE_TAG_`, login, all roles, Pipeline CRUD, audit append, and that `MonthlySnapshot` read returns an authorized empty list (or actual historical rows), not HTTP-wrapper 503.
9. Run authenticated `POST /imports/preview` ONLY, <=200 source rows per batch, across all **412**. Use the latest verified source row identity and approved AE/Partner/Region/Product/Type mapping. Compare READY, ALREADY_IMPORTED, HOLD and POTENTIAL_DUPLICATE with live Production.
10. Keep all 210 static DATA_HOLD and 79 static PREVIEW_CANDIDATE **uncommitted** until backend READY and user approval. Preview is read-only: confirm exact Production Pipeline/Event/Admin_Audit snapshots/hashes unchanged.
11. Only after explicit approval to commit, send <=200 READY rows per batch to `POST /imports/opportunities`; reconcile imported, already imported, failures and all source keys before next batch. Verify no edits to existing user-created Pipelines, handler/owner/stage/status/financials, historical Events and Activity History.
12. Monitor Snapshot projection error and repair only via `repairGeoRegionalSnapshotProjections` if its canonical technical row is committed. Never recapture old month from present-day data.

## Blockers / do not claim completion
- PR CI is synthetic; authenticated /exec UAT checks, actual read-only 412-preview, cross-workbook rollback, and full Production integrity comparisons remain outstanding.
- Two Google Spreadsheets are not ACID; both snapshots and audit must be reconciled if a crash occurs between commits.
- The 412 offline Excel identity ledger is a source register, not an approval to import or an authenticated backend validation result.
- All three GitHub PRs must remain drafts until a single, explicitly approved integration release is selected. Do NOT merge both component PRs separately without rebase/conflict review.
