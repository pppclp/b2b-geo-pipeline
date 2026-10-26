# Scenario Task Configuration — Stage Aging, SLA and Task Overdue

## Three independent checks, one Overdue queue

1. Stage Aging: `Aging_Settings.stage_watch_days` (currently 7 calendar days), checked with strict `>`.
2. Stage SLA: `Stages.sla_days` per Stage. Blank disables this check (not evidence that SLA was met).
3. Task Overdue: `Scenario_Tasks` by **Scenario ID × Stage ID × Task ID**. Only active, started, unfinished tasks are eligible. A Pipeline appears **once** even if all three checks match.

Scenario **S1/S2/S3/S3-EX/S4** and Sales **Stage 1/2/3/4** are separate dimensions. Do not confuse them.

## Google Sheets

- B2B_GEO_Pipeline_Config → `Scenario_Tasks` (new): `task_id | scenario_id | stage_id | task_name | sort_order | sla_days | day_type | start_policy | working_with_id | active | notes`.
- B2B_GEO_Pipeline_DB → `Pipeline_Tasks` (new): system-owned progress. **Never manually edit** this table.
- B2B_GEO_Pipeline_Config → `Aging_Settings.stage_watch_days` = 7; `Stages.sla_days` is the Stage SLA.

No active Scenario Task rows are seeded because actual business tasks, durations and assignments have not been approved. Empty template means **no task overdue**, not zero days overdue.

## Task rules

- `scenario_id`: existing `Scenarios.scenario_id` (for example SC001).
- `stage_id`: existing `Stages.stage_id` (for example STG001).
- `task_id`: unique stable key (do not recycle for a different task).
- `sort_order`: positive integer; controls ordering.
- `sla_days`: 1–365, or blank for no SLA configured.
- `day_type`: `calendar` or `business`; business currently counts Monday–Friday **only**, not Thai public holidays. Do not enter business-day SLA without confirming the holiday policy.
- `start_policy`: `stage_entry` starts from that Stage entry; `manual` requires explicit Start; `after_previous` starts when preceding ordered task is completed.
- `working_with_id`: optional existing Working_With team.
- `active`: Yes/No.

Changing Scenario/Stage does not erase old `Pipeline_Tasks` rows; only the current Stage entry is evaluated. Completed tasks are locked and task updates append Pipeline_Events.

## Safe rollout order

1. Backup Config and DB; create both new tabs; confirm exact headers (already prepared in connected UAT Sheets).
2. Populate **approved** task templates; verify their Scenario × Stage mappings and SLA policy.
3. Merge tested GitHub branch only after the matching Apps Script backend is ready.
4. From the same Git revision, run `npm ci`, `npm run gas:build`, `node scripts/gas-singlefile.mjs`, then update the **existing** Apps Script deployment; use the repository's controlled UAT release process.
5. Test role scoping, read/update Task, Stage change, Scenario change, overdue tags and quick-view counts; publish Frontend only after API/UAT verification.

Do not delete `Action_SLA`: it documents a separate special-price approval process and is not automatically a Scenario Task mapping.
