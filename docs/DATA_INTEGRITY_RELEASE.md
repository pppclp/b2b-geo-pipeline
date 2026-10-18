# High-priority data integrity changes — UAT release notes

## Purpose
Resolve three problems before the next Apps Script rollout, without adding master sheets or enabling Enterprise scenarios.

### 1. Opportunity + History
- Frontend submits **one** create/update request to `entities/Opportunity`.
- Backend calculates before/after changes, writes `Pipelines` and appends authoritative `Pipeline_Events` in **the same request and logical unit of work**.
- Event author and timestamp always come from the verified backend session, never from the browser.
- Quick Actions can produce multiple Audit Events (e.g., Stage + Handler + Working With) from the same saved record.
- Direct POST to `OpportunityHistory` is forbidden, even for Admin. Existing audit records are read-only.
- Legacy `*_Export_Template` workbooks are **not** written by the backend. Opportunity history stays in `Pipeline_Events`; Admin master changes stay in DB-backed `Admin_Audit`.

### 2. Permissions
- Management: create and update Pipeline (with existing region scope).
- AE: export own/handled Pipeline rows only. Export delivery remains a separate UX feature.
- The `Pipeline_Events` table is server-generated and append-only.
- Admin only: controlled Snapshot Capture. Direct snapshot create/delete/bulk-write is forbidden.
- No new Enterprise role, scenario routing, or CCP+ workflow in this patch.

### 3. Snapshot Capture
- Browser now sends **only** `POST /snapshots/capture { snapshot_period: "YYYY-MM" }`.
- Backend reads the current canonical `Pipelines` table, checks unique Pipeline IDs, validates data,
  builds a complete snapshot and replaces the target month in memory before touching storage.
- Other periods are retained unchanged. An empty/invalid source refuses to replace existing data.
- No separate delete-then-bulkCreate calls are made from the browser.
- The snapshot represents **current Pipeline state at capture**, not a time-travel reconstruction.

### Transaction and recovery behavior

**Node / local Excel**: Pipelines, Events, Snapshots and Admin_Audit share a single runtime DB XLSX.
The adapter writes to a temporary file, then atomically renames it onto the live workbook.
Source DB write failures do not partially overwrite an existing workbook.

**Google Apps Script / Google Sheets**: Google Sheets does not supply ordinary
multi-sheet ACID transactions through `SpreadsheetApp`. While holding a script lock,
the adapter creates hidden backups of each canonical DB sheet that will be modified,
writes a durable Script Properties transaction marker, then writes and flushes the DB.
If an error occurs, it restores prior sheet values from those backups. A later request
reconciles a crashed/interrupted transaction before reading live Pipeline data.
The three standalone Current/Change Log/Month-End Export Template spreadsheets are not runtime outputs. Reports are generated from the canonical DB on demand.

Google Sheets remains a UAT limitation: simultaneous/independent scripts or direct
manual edits of live sheets can bypass the single script lock, and restoration itself
can fail due to quota/service outages. Keep the hidden `__GEO_BAK__*` tabs and
`GEO_RUNTIME_DB_TXN` Script Property intact if an emergency rollback fails;
never delete them manually until a verified recovery is performed.

### One coordinated deployment (do not deploy backend alone)
1. PR #17 (verified-session authentication) is already merged to main.
2. Merge PR #18 only after reviewing the new integration tests.
3. Update **the same** Apps Script project using the current main branch,
   `npm run gas:build` and `npm run gas:push`; confirm expected Spreadsheet IDs.
4. **Manage deployments → Edit existing deployment → New version**.
   Keep the existing /exec URL. Do not run `setup()` again to import/erase data.
5. Test UAT using separate AE, SM, Management and Admin accounts:
   - New Pipeline creates one matching Audit Event, stamped with real actor.
   - Stage + Handler update creates both events in the same request.
   - Won/Lost (including reason) and Hand-off are logged.
   - Management creates/edits within role scope; AE cannot edit other AE rows.
   - Admin recaptures an existing month without duplicates or deleting other months.
   - A forced snapshot error preserves the prior month in the canonical DB.
6. Verify no leftover `__GEO_BAK__*` tabs and no `GEO_RUNTIME_DB_TXN` property after successful tests.
7. Before deploying, run `prepareAdminAuditSheet()` in the existing Apps Script project after pushing updated sources (do not deploy yet), and confirm the DB has four tabs.
8. Check the Admin_Audit row created by a master edit and confirm the historical Export Template sheets are not written.

No live Apps Script files, user master spreadsheets, customer records or deployment
versions are changed by the GitHub PR.

### Production direction
For strict ACID transactional guarantees, migrate the canonical runtime
Pipeline/Event/Snapshot data to a transactional database managed behind a
verified identity layer. The Apps Script backup/restore plan mitigates UAT
failures, not a substitute for database transactions, backup policies or SSO.

## Cross-workbook limitation

Admin_Audit is persisted in the canonical DB while the master records themselves
still live in separate Google Sheets. The current UAT Apps Script adapter is **not
ACID across spreadsheet files**; a service or quota failure can commit the audit
before the master workbook finishes saving. Treat such failures as reconciliation
items, and do not claim master updates are atomically committed across files.

Do not archive the existing Change_Log_Export workbook until its historical
`MASTER_*` events have been reconciled or intentionally retained as an
immutable historical archive. The new Admin_Audit does not backfill them.
