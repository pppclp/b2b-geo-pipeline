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

## Pipeline DB runtime workbook

`B2B_GEO_Pipeline_DB` is now the live transaction database and must contain only these
three runtime sheets:

- `Pipelines` — current state, one row per Pipeline.
- `Pipeline_Events` — append-only audit trail of changes.
- `Snapshots` — one row per Pipeline × snapshot period for analysis / commission.

`Snapshots` stores only the latest `stage_id` at capture time plus
`stage_last_updated_at`. Historical Stage changes belong in `Pipeline_Events`, not
duplicated in `Snapshots`. Re-capturing the same `snapshot_period` replaces that
period so it does not create duplicate commission rows.

The runtime DB does **not** duplicate User, Region, Product or Pipeline Config masters;
those remain in their dedicated master workbooks.

## Use Google Sheets (Apps Script backend)

The same backend logic (`server/core.js`) runs as an Apps Script web app that reads and
writes the Google Sheets directly.

1. Turn on the Apps Script API: https://script.google.com/home/usersettings
2. `npx clasp login`, using the Google account that owns or can edit the sheets.
3. `npx clasp create-script --type standalone --title "B2B GEO Pipeline API" --rootDir apps-script`
4. `npm run gas:push` builds `apps-script/` from the YAML and `.env.local`, then pushes it.
5. `npx clasp open-script`, then run **`setup`** and allow access. It checks every sheet and
   creates `B2B_GEO_Pipeline_DB` only when no DB is configured. The configured DB must contain
   `Pipelines`, `Pipeline_Events`, and `Snapshots`. Copy the Sheet ID into `.env.local` as
   `GEO_SHEET_ID_B2B_GEO_Pipeline_DB`, then run `npm run gas:push` again.
6. In the editor, choose Deploy → New deployment → Web app.
   - Execute as: Me
   - Who has access: Anyone

   Copy the `/exec` URL into `.env.local` as `VITE_GEO_API_URL`, then restart `npm run dev`.

After any backend or YAML change, run `npm run gas:push` and update the deployment (Deploy →
Manage deployments → Edit → New version) so the `/exec` URL serves the new code. Renaming or
replacing the runtime DB with a different Google Sheet also requires the Script Property
`GEO_SHEET_ID_B2B_GEO_Pipeline_DB` to point to that exact Sheet ID.

## Pipeline Config — current app alignment

The nine-sheet Config workbook supplied separately in this conversation preserves
existing `Stages`, `Scenarios`, `Lost_Reasons`, `Working_With`,
`Support_Types`, `Aging_Settings` and their Stable IDs. It adds only
`Stage_SLA`, `Action_SLA`, `Field_Options`. Documentation sheets are excluded.

- `Aging_Settings`: default 14 **calendar days** for Stage Aging.
- `Stage_SLA`: optional per-Stage threshold; blank uses global fallback. A
  business-day Stage SLA **does not trigger overdue warnings** until the
  corporate holiday calendar is integrated.
- `Action_SLA`: optional action process, approval level, optional
  `working_with_id` and optional time target. Special price approval is
  **12 working days in total** (Pricer 2, N3 2, N2 3, N1 5). Definitions do
  not create action-instance clocks or automatic Action SLA alerts.
- `Field_Options`: source of Sales Channel, Customer Type and CCP+ choices,
  with migration-time UI fallback to existing static values. Status and
  Permissions are **not** configured by this sheet.
- `Scenario` and `CCP+`: reviewed by SM; this config does **not** grant ENT
  login, Enterprise routing, or S3/S4 approval permissions.
- `Lost_Reasons` remains the source of required reason when closing a
  Pipeline as Lost. Existing Won/Lost and audit workflows are retained.
- Net RC remains `(Subs × Price/Month) + (OC / 12)`. No config sheet
  overrides that calculation.

### Migration and Apps Script release — UAT first

1. Back up the **current linked Google Sheets** Config workbook. Export its
   six existing Master tabs and compare IDs and Admin edits against the new
   nine-sheet XLSX; don't replace production Master rows blindly.
2. In the **existing mapped Google Sheets** (`GEO_SHEET_ID_B2B_GEO_Pipeline_Config`),
   merge the six existing tabs by stable IDs and add three new tabs with exact
   names/columns: `Stage_SLA`, `Action_SLA`, `Field_Options`.
   Do **not** delete Pipeline DB or Opportunity Events.
3. Validate locally with `npm run config:check -- /path/to/config.xlsx`.
4. Merge the code change only after sheets are prepared. On the authorized
   Apps Script development machine run `npm run gas:push`.
5. From Apps Script editor run `verifyPipelineConfigSchema()` to check the
   actual linked Google Sheets before release. Correct any missing tabs/headers.
6. **Deploy → Manage deployments → Edit → New version → Deploy**. Keep
   existing Web App deployment URL and Spreadsheet ID.
7. Test AE/SM/Management/Admin reading, edits to dropdowns, Stage SLA Alerts,
   Won/Lost with Lost Reason, and preserved history. Use UAT data.

Apps Script `Main.js` performs the preflight, while the generated `GeoCore.js`
and `Contract.js` include the updated Backend Core and YAML mapping.
GitHub Pages deploys **frontend only**; it does not change Apps Script.
The new Excel file is a **new copy**, not an overwrite of live Google Sheets.

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
