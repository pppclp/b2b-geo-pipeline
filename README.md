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

- **Sign in (UAT only):** Employee ID + temporary password from the restricted
  UAT credential workbook. Login issues a short-lived (4-hour) signed session;
  the backend validates it on every request rather than accepting browser user IDs.
  See [UAT security review](docs/UAT_SECURITY_REVIEW.md). **Not production SSO.**
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
- **Admin → Source Sheets:** maintain User/Organization and Pipeline Config master
  tabs (including Product_Categories). Products are entered as free text. A delete is refused while other rows still reference the ID (from `referenced_by` /
  `used_by` in the YAML).

## Reports and audit (one canonical Pipeline DB)

The three historical `*_Export_Template` Google Sheets are **not writable runtime
dependencies**. No background mirroring is performed on Pipeline changes.

- **Current Pipeline Excel (.xlsx):** generated from the authenticated,
  role-scoped `Pipelines` API when users click Export Excel.
- **Opportunity History:** canonical `Pipeline_Events`; the Admin Change Log CSV
  is generated from the records the logged-in user can read.
- **Month-end:** canonical `Snapshots`; historical reports can be generated
  from a chosen month without maintaining a duplicate spreadsheet.
  A dedicated downloadable month-end workbook still needs UI implementation.
- **Master changes:** stored in `Admin_Audit`, readable by Admin only.

Keep old templates archived until historical output records have been reviewed.
Do not delete or treat them as a source of truth.

## Pipeline DB runtime workbook

`B2B_GEO_Pipeline_DB` is now the live transaction database and must contain only these
four runtime sheets:

- `Pipelines` — current state, one row per Pipeline.
- `Pipeline_Events` — server-generated audit events of Opportunity changes.
- `Snapshots` — one row per Pipeline × snapshot period for analysis / commission.
- `Admin_Audit` — append-only audit events of master-data edits (Admin-only).

`Snapshots` stores only the latest `stage_id` at capture time plus
`stage_last_updated_at`. Historical Stage changes belong in `Pipeline_Events`, not
duplicated in `Snapshots`. Re-capturing the same `snapshot_period` replaces that
period so it does not create duplicate commission rows.

The runtime DB does **not** duplicate User, Region or Pipeline Config masters.
Product_Categories is a tab in Pipeline Config; product_details is free text in
each Pipeline. The old B2B_Product_Master spreadsheet is archived/read-only,
not referenced by the runtime API or generated Apps Script SheetIds.js.

## Temporary UAT login recovery (2026-10-25)

If existing Employee ID + temporary-password logins suddenly fail after the
hardened backend release, follow [UAT login recovery and role smoke tests](docs/UAT_LOGIN_RECOVERY.md).
The guarded manual 14-day recovery is **UAT-only**, must be explicitly approved,
and does not change Pipeline scopes or provision new user accounts. Production
requires a separately reviewed corporate identity integration.

## Hardened UAT rollout (2026-10-24)

This change requires a coordinated release. GitHub Pages deploys the frontend
only; the authenticated Apps Script /exec URL uses a separately versioned
deployment. Generate and push matching Main.js, GeoCore.js, Contract.js and
SheetIds.js, then edit the existing Apps Script deployment to a new version.
Never replace the current backend with an unrelated older Code.gs file.

Before deploying:
- Back up the restricted UAT credential workbook; use the existing
  migrateUatCredentialsToSaltedHashes() helper with explicitly approved
  GEO_UAT_HASH_MIGRATION_APPROVED=YES. Verify no plaintext credentials remain,
  and GEO_UAT_REQUIRE_HASHED_PASSWORDS=true. Remove migration approval.
- Passwords stored as salted/peppered HMAC are for UAT ONLY. Corporate SSO
  and a privacy/security review remain prerequisites to real customer data.
  Plaintext fallback now requires the exceptional Script Property
  GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS=true, to be removed after migration.
- Verify Pipelines has the client_request_id column. It records the Create
  form's stable UUID for retry deduplication; existing Import uses separate
  batch identity. Legacy API clients without a key can still create duplicates.
- All Pipeline PUT calls must send expected_updated_at. Missing revisions
  return 428 and stale revisions return 409. Closed deals allow notes and
  separately audited status transitions, not arbitrary Stage/Handler edits.
- API requests use POST (including logical reads); GET supports health only.
  Internal backend errors return an error ID instead of implementation details.
- Verify Admin/SM/AE Pipeline visibility and all Create/Edit/Handoff/Reopen
  flows in UAT after backend deployment. A passing GitHub build does not
  confirm the Apps Script runtime or workbook bindings.

## Use Google Sheets (Apps Script backend)

The same backend logic (`server/core.js`) runs as an Apps Script web app that reads and
writes the Google Sheets directly.

1. Turn on the Apps Script API: https://script.google.com/home/usersettings
2. `npx clasp login`, using the Google account that owns or can edit the sheets.
3. `npx clasp create-script --type standalone --title "B2B GEO Pipeline API" --rootDir apps-script`
4. `npm run gas:push` builds `apps-script/` from the YAML and `.env.local`, then pushes it.
5. For the **existing** Apps Script project, preserve the deployed `/exec` URL.
   Ensure its `GEO_SHEET_ID_B2B_GEO_Pipeline_DB` and
   `GEO_SHEET_ID_B2B_GEO_Pipeline_Config` properties point to the intended
   workbooks; the Config workbook must contain `Product_Categories`.
   Before releasing this branch, run **`prepareAdminAuditSheet()`** once in the
   Apps Script editor to create/verify `Admin_Audit` without modifying existing
   Pipelines, Events or Snapshots. This preparation helper must be pushed to the
   project before running it; do not update the public web app deployment yet.
6. After verifying DB schema and Sheet IDs, choose **Deploy → Manage deployments →
   Edit existing deployment → New version**. Do not create a new web app deployment.
   The existing `/exec` URL remains unchanged.

After any backend or YAML change, run `npm run gas:push` and update the deployment (Deploy →
Manage deployments → Edit → New version) so the `/exec` URL serves the new code. Renaming or
replacing the runtime DB with a different Google Sheet also requires the Script Property
`GEO_SHEET_ID_B2B_GEO_Pipeline_DB` to point to that exact Sheet ID.

Apps Script resolves Sheet IDs from **Script Properties first** and only falls back to the
generated `SheetIds.js`. This prevents an older bundled Sheet ID from overriding a newly
configured runtime DB. After changing the property, run `debugPipelineDbBinding()` in the
Apps Script editor and confirm the output shows `Pipelines`, `Pipeline_Events`, and
`Snapshots` and `Admin_Audit` with the expected row counts.

## Net RC calculation (new and repriced Pipelines)

Net RC (THB/month) = (Number of Subs × Price per Sub/month) + (OC ÷ 12).
OC is optional (blank = 0); divisor is always 12, not Contract Period.
The backend is authoritative and the frontend displays a read-only preview.
The existing `pipeline_value` column supplies Cards, Dashboard and Excel exports and represents Net RC for newly created or repriced records.

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

## UAT vs. Production safety boundary

This GitHub Pages app and its internet-reachable Apps Script endpoint are **UAT-only**, not production security-approved CRM infrastructure. Use synthetic/mock customer records only until authorized corporate identity, access controls, data protection and operational review are approved. A four-hour signed UAT session and credential hashing do **not** replace corporate SSO, MFA or security monitoring.

Before deploying, verify backend/frontend release alignment and required Google Sheet schemas. See [UAT release gates](docs/UAT_RELEASE_GATES.md) and [security review](docs/UAT_SECURITY_REVIEW.md). Opening a PR or passing GitHub Actions **does not deploy** an Apps Script version.
