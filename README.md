# B2B GEO Pipeline

Sales pipeline web app (React + Vite). The backend reads and writes Excel / Google Sheets files
whose names, sheets and columns follow `b2b_geo_pipeline.yaml`.

## Run Locally

Requires Node 20+.

```bash
npm install
npm run sheets:pull   # optional: copy the real Google Sheets into data/
npm run dev           # http://localhost:5173 — frontend + local API together
```

- **Sign in:** pick a user from the `Users` sheet on the login page. This is dev-only and is
  not real authentication.
- **Data:** stored as `.xlsx` in `data/` (gitignored). `sheets:pull` downloads every sheet that
  has a `GEO_SHEET_ID_*` in `.env.local` and overwrites the local copies. If the master files
  are missing, sample data is created instead. Local edits stay in `data/`; they are not sent
  to Google.
- **Permissions:** `access_control` at the end of `b2b_geo_pipeline.yaml` controls:
  - which file and sheet backs each entity
  - which role can `read` / `create` / `update` / `delete` / `import` / `export`
  - each role's row scope (`own` / `region` / `all`)
  - `excluded_sheets`: README and Data_Dictionary are never read or written

  Edits to the YAML take effect without a restart.
- **Admin → Source Sheets:** add, edit and delete rows in every sheet of the three master
  files. A delete is refused while other rows still reference the ID (from `referenced_by` /
  `used_by` in the YAML).

## Output Sheets (logs and exports)

The three `*_Export_Template` files are **output only**. The backend writes them after each
action and never reads them back. `output:` in `access_control` lists which sheets are written:

| File / sheet | Written when |
|---|---|
| Change_Log → `Change_Log_Export` | One row appended per Opportunity event by AE / SM / Admin (types follow `Event_Type_Reference`), plus `MASTER_CREATED/UPDATED/DELETED` for master-data edits |
| Current_Pipeline → `Current_Pipeline_Export` | Regenerated after any Opportunity change (one row per Opportunity) |
| Month_End → `Open_Pipeline_Snapshot`, `Closed_Won`, `Closed_Lost`, `Summary` B3/B5 | When Admin captures a month-end snapshot |

Columns the templates computed with formulas (event_month, aging days, weighted value) are
written as values. `setup()` in Apps Script and `npm run sheets:pull` clear the template sample
rows once.

## Use Google Sheets (Apps Script backend)

The same backend logic (`server/core.js`) runs as an Apps Script web app that reads and
writes the Google Sheets directly.

1. Turn on the Apps Script API: https://script.google.com/home/usersettings
2. `npx clasp login`, using the Google account that owns or can edit the sheets.
3. `npx clasp create-script --type standalone --title "B2B GEO Pipeline API" --rootDir apps-script`
4. `npm run gas:push` builds `apps-script/` from the YAML and `.env.local`, then pushes it.
5. `npx clasp open-script`, then run **`setup`** and allow access. It checks every sheet and
   creates `B2B_GEO_Pipeline_DB`. Copy the ID it logs into `.env.local` as
   `GEO_SHEET_ID_B2B_GEO_Pipeline_DB`, then run `npm run gas:push` again.
6. In the editor, choose Deploy → New deployment → Web app.
   - Execute as: Me
   - Who has access: Anyone

   Copy the `/exec` URL into `.env.local` as `VITE_GEO_API_URL`, then restart `npm run dev`.

After any backend or YAML change, run `npm run gas:push` and update the deployment (Deploy →
Manage deployments → Edit → New version) so the `/exec` URL serves the new code.

## Pipeline configuration (Stage SLA / Action SLA)

Updated source workbook: `B2B_GEO_Pipeline_Config_SLA_Updated.xlsx`.
The **logical source filename remains** `B2B_GEO_Pipeline_Config.xlsx` in YAML.
The following existing sheets/IDs are unchanged: `Stages`, `Scenarios`,
`Lost_Reasons`, `Working_With`, `Support_Types`, `Aging_Settings`.

The new runtime tabs in the **same mapped Google Spreadsheet** are:

- `Stage_SLA`: optional per-stage calendar-day limit; blank falls back to the
  existing global Stuck threshold. Business-day Stage SLA is deliberately
  **not flagged overdue** until an approved company holiday calendar exists.
- `Action_SLA`: optional internal action definitions, optional Working With
  team and optional SLA duration. Pricing approval example:
  **12 working days total = Pricer 2 + N3 2 + N2 3 + N1 5**. N1/N2/N3 are
  approval levels, not Working With teams. The process total must not be
  counted in addition to its steps.
- `Field_Options`: configurable dropdown values for `sales_channel`,
  `customer_type` and `ccp_check_result`. System status transitions are
  never editable from this sheet.
- `Scenario_Rules`: **read-only reference data**, not an Enterprise approval
  or automatic handoff engine.
- `Pipeline_Fields`, `Net_RC_Example`, and `Data_Dictionary` remain
  documentation. `Change_Log` was removed from the workbook (application
  audit remains in separate Opportunity Events and backend logs).

### Required rollout steps (do NOT overwrite the live source blindly)

1. **Back up** the current Google Sheets Pipeline Config, including any edits
   made in the Admin app since the last exported workbook.
2. Compare the six existing master tabs by stable ID. Merge needed changes,
   **preserving production IDs/rows**, rather than replacing current data.
3. Add the four new runtime tabs from the updated Excel to that same Google
   Spreadsheet, preserving their exact names and column headers.
4. Keep the current `GEO_SHEET_ID_B2B_GEO_Pipeline_Config` and logical YAML
   filename; no new API URL or separate Sheet ID is required.
5. After merging this PR, run `npm run gas:push` from a configured development
   machine, then Apps Script **Manage deployments → Edit → New version → Deploy**.
   Github Pages deployment alone does **not** deploy the changed Apps Script.
6. Verify role-scoped master reads, Admin edits, Stage SLA fallback, existing
   Pipeline history and alerts in UAT before enabling this for users.

**Not implemented by this update:** Action SLA runtime clocks/alerts (they
require action-instance start/completion events and a business holiday calendar),
Enterprise S3/S4 approval routing, and automatic approvals. Empty SLAs do
not create fake alerts or imply approval. Dashboard Stuck checks only use
Stage SLA (with global fallback).

## Net RC calculation (new and repriced Pipelines)

Net RC (THB/month) = (Number of Subs × Price per Sub/month) + (OC ÷ 12).
OC is optional (blank = 0); divisor is always 12, not Contract Period.
The backend is authoritative and the frontend displays a read-only preview.
The existing `pipeline_value` column supplies Cards, Dashboard, CSV and
output sheets and represents Net RC for newly created or repriced records.

**Legacy values:** Existing records without `price_per_sub` are not silently
recalculated. They retain the older manually entered amount until the unit
price is supplied. Review these records before using mixed-era Dashboard totals
as confirmed Net RC. Local Excel and Google Sheets backends will need the new
`price_per_sub` column; redeploy Apps Script after backend changes.

## Create Pipeline UI (UAT)

The **New Pipeline** action opens a centered, expandable modal with
Customer Information, Product & Value, and Additional Information sections.
AE fields are required as indicated in the form; Remark and Product Details
are optional. Scenario and CCP+ Check are displayed to AE as read-only
**Pending SM Review** placeholders. Region, Territory, owner, and creation
timestamps are derived from User Master / session information, not entered
again by AE.

New fields `contact_name`, `contact_phone`, `sales_channel`,
`partner_name`, `remark`, `product_details`, and `ccp_check_result`
are persisted as additional Opportunity sheet columns by the local Excel
or Google Sheets backend. Existing historical records and the Edit
Pipeline form are intentionally preserved. Configure a default Region
for any AE assigned to more than one Region before creating their Pipeline.

## Layout

- `b2b_geo_pipeline.yaml`: data contract and `access_control`.
- `server/core.js`: routing, permissions, scope and row operations. It is sync and runs in
  both Node and Apps Script.
- `server/api.js` and `server/store.js`: local adapter (Vite middleware at `/api`) over
  `data/*.xlsx`.
- `server/contract.js`: reads the YAML. `server/entities.js` maps UI fields to sheet columns.
  `server/seed.js` holds the sample data.
- `apps-script/Main.js`: Apps Script entry point and Google Sheets store. The other files in
  `apps-script/` are generated.
- `scripts/`: `sheets:pull` and `gas:build`.
- `src/api/client.js`: frontend client. It talks to `/api`, or to Apps Script when
  `VITE_GEO_API_URL` ends in `/exec`.

## Legacy: Base44

This app was originally built on Base44. The notes below describe that setup and no longer apply to `npm run dev`.

### Frontend Only, Hosted Backend

To work on just the frontend against your app's live hosted backend:

```bash
base44 dev --remote
```

⚠️ In this mode writes go to your app's **production data** — plain `base44 dev` keeps everything local.

### Publish Your Changes

After pushing your changes to git, open the Base44 dashboard and publish the app:

```bash
base44 dashboard open
```

This repo syncs to Base44 through git, so publish from the dashboard rather than `base44 deploy` — a CLI deploy ships your local tree directly, bypassing the sync, and the deployed state silently diverges from the repo.

### Docs & Support

GitHub integration: [https://docs.base44.com/developers/app-code/local-development/github](https://docs.base44.com/developers/app-code/local-development/github)

Local development: [https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview](https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview)

Support: [https://app.base44.com/support](https://app.base44.com/support)
