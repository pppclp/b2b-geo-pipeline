# Dashboard, SLA & Excel Export — UAT Definitions

## Shared dashboard filter scope

All dashboard cards, charts, tables and role-specific lists are computed from the **same cohort**:
`authenticated role/region scope ∩ (Region quick filter) ∩ (Created Month) ∩ (Expected Close Month)`.

If two month filters are populated, **both** apply together (AND). Clearing either month
removes that condition. Dashboard links to the Pipeline page preserve those filters.
The Pipeline page now accepts `status=all` so that the Created card can drill into
every status instead of silently defaulting to Open.

| KPI | Definition within selected cohort |
| --- | --- |
| Created Pipelines | **All** Pipelines created in the selected Created Month (Open, Won, Lost, Archived). If month unset, all accessible Pipelines. |
| Open Pipelines | Currently status = Open. |
| Expected to Close | Currently Open with a nonempty Expected Close Month, constrained by the selected Expected Close filter if provided. |
| Won | Currently Won. When Expected Close Month is selected this filters by **expected close**, not Won date. |
| Lost | Currently Lost. When Expected Close Month is selected this filters by **expected close**, not Lost date. |
| Support Needed | Currently Open, Support Needed. |
| Stage SLA Overdue | Currently Open, configured Stage SLA is greater than zero, Stage elapsed calendar days > Stage SLA. |
| Internal SLA Overdue | Currently Open and Working With active, timestamp present, elapsed calendar days > configured Internal Working With SLA. |

Stage/Product/Region/AE breakdowns all use the **Open** subset of the shared cohort.
Lost Reason chart uses the **Lost** subset. Attention Needed deduplicates Stage/Internal
overdue and Support Needed. All dashboard count/value cards use current Pipeline records,
not historical as-of-month values; a true historical value metric should use `Snapshots`.

## SLA master data: no new tabs

- Existing `B2B_GEO_Pipeline_Config` → `Stages`: optional `sla_days` (positive integer 1–365), editable in Admin → Stages.
  Blank means unconfigured; it is **not silently replaced by the old global threshold**.
- Existing `B2B_GEO_Pipeline_Config` → `Aging_Settings`: optional
  `internal_task_sla_days` (positive integer 1–365), editable in Admin → Config.
  Blank disables this alert until confirmed.
- Old `threshold_days` is retained for backward compatibility, but is no longer used as Stage SLA.
- Each timer is independent: `stage_entered_at` vs `working_with_since`.
  A handler change should not reset Stage SLA.
- The Internal SLA is **currently a Working With / coordination timer**, not a
  per-subtask SLA. If future Internal Tasks each need Owner, Due Date, Pause/Resume,
  and completion evidence, introduce a dedicated child task entity at that point.
- SLA is based on elapsed **calendar days**, not business days, and is triggered
  only when elapsed full days is **greater than** the configured limit.

On the first UAT deployment the new column is absent from existing Google Sheets.
Admin saving a configuration adds that **column to the existing tab**; no new
workbook or tab is required. Business owners must decide individual Stage and
Internal SLA values; do not invent defaults.

## Pipeline Export

- Pipeline → **Export Excel** writes a true XLSX workbook using ExcelJS, not CSV.
- Dashboard-created filters and all Pipeline page filters are applied to exported rows.
- The server checks `Pipelines.export` in the YAML and then restricts rows using
  the authenticated actor's `own / region / all` scope. The client can only
  further **intersect** those server-authorized rows with visible filter IDs.
- AE exports own/current-handled Pipelines, SM exports Region, Management follows its
  configured Region/global scope, Admin exports all.
- Business IDs, phone numbers and other identifiers remain strings, preserving
  leading zeroes; Net RC is a numeric Excel cell. XLSX has frozen headers and filters.
- Admin → Exports → Current Pipeline is also XLSX and uses the same authorization.
  Change Log remains CSV; captured historical month-end snapshots are in Snapshots,
  not mislabeled as the current export.

## Deployment order

**GitHub PR #18 (High) → PR #19 (Medium) → one coordinated Apps Script push and
deployment.** Do not Deploy Apps Script for this branch alone.

After both PRs merge, `npm run gas:build && npm run gas:push` to the **existing**
Apps Script project, then Deploy → Manage deployments → Edit → New version.
Keep existing `/exec` URL, verify all Script Properties and test with AE, SM,
Management and Admin UAT accounts.

Validate all eight metrics and drill-down links with Created Month and Expected
Close set simultaneously. Enter realistic SLAs in Admin, test an overdue Stage
and Working With handoff separately, and verify different users receive only
their own export rows. Excel generation is client-side; restrict sensitive
spreadsheets and avoid logging customer data.
