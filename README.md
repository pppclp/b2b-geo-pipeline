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
