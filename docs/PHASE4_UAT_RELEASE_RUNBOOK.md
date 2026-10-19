# Phase 4 UAT migration & coordinated deploy

**Current status:** Source and CI only. **Do not paste, Deploy, or run the new UI against the old Apps Script.** Release Phases 1–4 together, after UAT-specific deployment checks. The canonical DB contains 112 mock Pipelines and 28 `support_needed = Yes` records.

## Scope locked by user

- In-app notifications **only** for receiving a Handoff: recipient-scoped bell, unread badge, open related Pipeline and mark read; refresh approximately every 60 seconds while the app is active.
- Support Requests workflow: Open → In Progress → Resolved, Management/Admin may process region-authorized requests; regular users see those attached to their accessible Pipelines.
- Working With multiple teams and multiple region-scoped users; old single-team field remains compatible.
- Bangkok month-end scheduled snapshot: on day 1 of each month around 02:00, capture the **previous** YYYY-MM period. Already-captured periods are skipped.
- Remove only confirmed unused legacy dependencies and keep npm lockfile aligned.

## Deployment order — one Apps Script update only

1. Confirm private backups (restricted access) of **B2B_GEO_Pipeline_DB**, Configuration, User Master, UAT Credentials. Confirm 112 Mock Pipelines; **do not remove the old working Code.gs backup**.
2. Use the **single combined Code.gs** generated from the approved, integrated Phase 1–4 release, preserving V4 binding helpers `bindCurrentPipelineSources()` and `diagnoseMockPipelineVisibility()`. This branch source file `apps-script/Main.js` alone is **NOT** a drop-in replacement.
3. In Apps Script Project Settings, before running any migrations, explicitly set `GEO_PHASE4_SCHEMA_APPROVED=YES`. Confirm the DB Script Property exactly equals `1z2alvS2BSRCll-6CaQq2HetuVCjYW43cpdSuXTZNthc`; do not run `setup()` to initialize a replacement DB.
4. Run `prepareGeoPhase4Sheets()` once. It appends **five headers only** to the existing `Pipelines` sheet: `import_batch_id`, `import_row_number`, `import_row_signature`, `working_with_team_ids`, `working_with_user_ids`. It does **not change the 112 existing data rows**. It also creates only `Handoff_Notifications` and `Support_Requests` tabs (or validates their existing schemas). Run only after the restricted backup. The operation is idempotent. It refuses an unexpected workbook or mismatched existing headers.
5. Run `backfillGeoPhase4SupportFlags()` once. It creates missing Support Requests from historical `support_needed=Yes` flags, marks `source=migration`, does not attribute them to a newly submitting AE, does not modify Pipelines. It is idempotent. Expect approximately 28 migrated requests from the current 112-row mock dataset.
6. Deploy the combined Code.gs as a **new version of the EXISTING deployment**; keep the endpoint URL unchanged. Deploy the matching frontend revision in the same maintenance window (only after backend verified). Do not deploy the Phase 4 UI separately.
7. Run `diagnoseMockPipelineVisibility()`; test login/role views for AE/SM/Management/Admin; test a Handoff from AE to SM; confirm exactly one unread notification **only to recipient**, opening it marks read; test Support resolution updates the Pipeline flag; test Working With multi-selector, edit conflicts, batch import and rollback.
8. If monthly snapshots are approved, set `GEO_AUTO_SNAPSHOT_APPROVED=YES` and run `installGeoMonthEndSnapshotTrigger()` as the designated Apps Script operator. Confirm one time-driven trigger exists, timezone **Asia/Bangkok**, and successful initial dry-run tests. Trigger creation requires `script.scriptapp` OAuth scope. Leave the property absent if automation should not run.
9. **Password migration remains separate and opt-in**: follow `docs/PHASE1_UAT_CREDENTIAL_MIGRATION.md`, never clear plaintext before backup or tests. Phase 4 work does not itself migrate credentials.

## Safe rollback

- Keep the old Code.gs and original deployment version. If frontend/backend disagree, revert both matching versions.
- Never delete the 112 Pipelines or `Pipeline_Events`.
- Do not delete a Phase 4 sheet that already contains notifications or support replies: back up and reconcile data first.
- Backfill is idempotent; rerun only after reviewing counts.
- Global ScriptLock still serializes reads/writes, and full mutable-sheet backups remain; benchmark concurrency before any lock relaxation.

## Release gates (not satisfied by GitHub CI alone)

A passing CI only proves code-level checks and mocked local behavior. Real UAT still requires Apps Script execution, Google Sheets persistence, recipient permissions, trigger authorization and concurrency/load tests. **Do not call it production ready** until organization authentication and data protection controls are resolved.
