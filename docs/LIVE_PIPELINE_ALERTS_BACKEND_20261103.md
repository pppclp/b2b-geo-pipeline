# Live B2B GEO Pipeline Alerts — Existing Apps Script backend

This change targets the canonical **B2B GEO Pipeline backend for all authorized Pipelines**, not a demo or separate backend.

## Read-only computation (all records in the user's permitted scope)

Every `GET entities/Opportunity` / `GET entities/Opportunity/:id` returns `alert_state` and `working_with_team_since`. The source is the **same existing Google Sheets**:
- `B2B_GEO_Pipeline_DB / Pipelines`: current state and Stage/Handler clocks.
- `B2B_GEO_Pipeline_DB / Pipeline_Events`: immutable Change Log; adding, removing or re-adding Working With teams starts or resets **only** that team's timer.
- `B2B_GEO_Pipeline_Config / Stages`: per-Stage SLA.
- `B2B_GEO_Pipeline_Config / Aging_Settings`: AE and SM Handler SLAs and Working With fallback.
- `B2B_GEO_Pipeline_Config / Working_With`: per-team SLAs.
- `B2B_GEO_User_Org_Master / Users`: authoritative current Handler role.

The UI prioritizes the server's `alert_state.version=1` for Stage/Handler/Working With and continues to calculate task-specific overdue from authorized Task records. Multiple qualifying tags may be visible for one Pipeline; KPI Overdue counts the Pipeline once. Stage Aging remains informational; Won/Lost do not raise active SLA alerts.

**Never fabricate historical clocks**. A legacy primary team's `working_with_since` is usable, but a secondary team with no verified Change Log entry has no provable start date and must not be flagged using the Pipeline creation date. On new Pipeline creation, the selected teams now receive a separate audited initial membership event. For updates, existing backend change events remain authoritative and append-only. No backfill or data rewrite is performed.

## Real environment rollout (NOT a demo setup)

1. Validate the existing production-bound/config-bound Apps Script project's exact sheet IDs, tab headers, permissions and UAT rollback snapshot; do not run `setup()` or any migration.
2. From this merged commit, generate the full Apps Script bundle: `npm run gas:build` followed by the existing approved `clasp push` process; **never paste only `Main.js`**. Deploy a NEW VERSION of the EXISTING `/exec` deployment. Preserve URL, credentials and all current Pipeline data.
3. Verify authenticated `Opportunity` responses on AE / SM / Management / Admin accounts contain `alert_state.version=1`, accurate team-wise clocks, and unchanged Pipeline row count and Change Log append-only behavior.
4. Only after backend verification, publish the matching frontend using the existing controlled Cloudflare Pages (if that's the active customer-facing URL) or GitHub Pages release process. GitHub workflow 'success' is insufficient if its deploy job was **skipped**. Cloudflare and GitHub Pages are separate deployments.
5. Smoke test a Pipeline with Stage SLA and Handler SLA simultaneously breached, plus two selected teams with different Change Log start dates; verify distinct tags and one KPI count. Verify updates to unrelated fields do not reset SLA clocks and Won/Lost do not alert.

This PR is **not** proof that the currently deployed Apps Script project or live Cloudflare site has been updated. A separate authorized release is necessary.
