# B2B GEO — Regional Snapshot Storage Repair (2026-11-01)

## Diagnosis (verified against live Google Sheets)
- Existing `B2B_GEO_Pipeline_DB` (ID `1z2alvS2BSRCll-6CaQq2HetuVCjYW43cpdSuXTZNthc`) **no longer has `Snapshots`**.
- The legacy contract intentionally exposes the **API entity** `MonthlySnapshot` backed by the **physical tab** `Snapshots`. These names are not interchangeable.
- The new `B2B_GEO_Regional_Reporting_Snapshots` (ID `1lYwJnEChx_Lzp9O9_1G4mJSJp1AhGHqKPEYSlcZDtrY`) contains eight **empty** regional presentation tabs with exactly 30 different display columns. It has no technical `Snapshots` tab.
- `503 REQUIRED_SHEET_MISSING` originates from the old Apps Script `SheetStore_.table()` lookup for `B2B_GEO_Pipeline_DB.xlsx / Snapshots`, not from a client-side UI bug.

## Safe architecture
Keep **one canonical technical `Snapshots` tab** in the reporting workbook, with the former 49 technical headers and two appended fields, `working_with_id` and `import_source_sales_code` (51 total). Keep eight existing 30-column region tabs as derived, append-only views.

Logical contract `MonthlySnapshot -> B2B_GEO_Pipeline_DB.xlsx / Snapshots` remains unchanged to preserve frontend compatibility. Only the Apps Script SheetStore physical routing for that one table changes. **Pipeline, Pipeline_Events, Admin_Audit, Auth and existing import workbooks remain bound to their original files**. Local Node development remains on its existing file store.

Physical regional tabs:
| Region ID | Sheet tab |
|---|---|
| BMA-E | BMA-East |
| BMA-W | BMA-West |
| CW | Central-West |
| E | East |
| N | North |
| NE1 | Northeast1 |
| NE2 | Northeast2 |
| S | South |

## Display-column mapping (new 30-column reports)

| # | Regional header | Frozen technical snapshot field / derivation |
|---|---|---|
| 1 | Snapshot Period | `snapshot_period` |
| 2 | Captured At | `captured_at` |
| 3 | Opportunity ID | `opportunity_id` |
| 4 | Created Month | `created_month`, else month portion of `lead_created_at` if present |
| 5 | Business ID | `business_id`, preserved as text |
| 6 | Customer Type | `customer_type` |
| 7 | Customer Name | `customer_name` |
| 8 | Contact Name | `contact_name` |
| 9 | Contact Phone | `contact_phone`, preserved as text |
| 10 | Sales Code | Historical import: frozen raw `import_source_sales_code` (blank if unavailable); standard Pipeline: frozen `owner_sales_code` (AE Employee ID). Preserve as text |
| 11 | AE Name | `owner_sale_name` |
| 12 | Sales Channel | `sales_channel` |
| 13 | Partner Name | `partner_name` |
| 14 | Region | `region_id` resolved via approved 8-region ID map |
| 15 | Province / Territory | `customer_location_text`, else `territory_id` |
| 16 | Product Category | `product_category_id` -> Config Product_Categories.category_name |
| 17 | Product Details | `product_details` |
| 18 | Subs | `quantity` |
| 19 | RC | Frozen `import_source_rc`; blank if not captured, never substitute price_per_sub |
| 20 | Net RC | Historical: frozen raw `import_source_net_rc` (may be blank); standard Pipeline: `pipeline_value` |
| 21 | OC | `oc` |
| 22 | Contract Period (Months) | `contract_period_months` |
| 23 | Stage | `stage_id` -> Config Stages.stage_name (historical disabled stage remains displayable) |
| 24 | Status | `status` |
| 25 | Expected Close Month | `expected_close_month` |
| 26 | Scenario | `scenario_id` -> Config Scenarios.scenario_name |
| 27 | CCP+ Check | `ccp_check_result` |
| 28 | Current Handler | `current_handler_user_id` -> Users.display_name |
| 29 | Working With | `working_with_id` -> Config Working_With.team_name, captured at snapshot time |
| 30 | Remark | `remark` |

**Important semantics:** An imported raw RC or raw Net RC is not the same field as unit price or the calculated live Pipeline Value. The report leaves unknown historical values blank. Standard non-imported Pipelines may have no separate historical RC in this report; do not fill it with price_per_sub. Keep `pipeline_value`, `import_source_rc`, and `import_source_net_rc` independently available in the technical snapshot.

**Migration release blocker:** The 58-column live `Pipelines` sheet does not yet expose independent `import_source_sales_code`, raw Subs, or raw OC provenance columns. `owner_sales_code` in the old technical Snapshot is the *AE employee ID frozen from Users Master*, not proof of the original Excel Sales Code. This patch appends a separate `import_source_sales_code` technical field (51 columns total), and displays it for imported rows **only if genuinely captured**. It stays blank until the separate Historical Import provenance schema is approved and deployed in PR #152. No existing row is rewritten to fabricate provenance.

## Preparation — do NOT run against production without backup/authorization
1. Confirm the two workbook IDs and names above, and verify current Pipeline + Audit backups. Do not recreate/delete the DB, do not run `setup()`.
2. Check any pre-migration snapshot evidence before approving a capture. The recent **Nov 1** backup `B2B_GEO_Pipeline_DB_BACKUP_PreStage3WonCorrection_20261101` has only a 49-column *header* in `Snapshots`, with no snapshot rows. An Oct 26 backup has some earlier 2026-10 snapshots, but **do not import these without confirming they are real rather than demo/test records**.
3. In the existing Apps Script project, under **Project settings -> Script properties**, add:
   ```
   GEO_SHEET_ID_B2B_GEO_Regional_Reporting_Snapshots=1lYwJnEChx_Lzp9O9_1G4mJSJp1AhGHqKPEYSlcZDtrY
   ```
   Preserve all previous DB, Config, Users, and Credentials Script properties.
4. In the feature branch, run `npm ci`, `node --test tests/regionalSnapshots.test.mjs`, `npm run gas:build`, then `node scripts/gas-singlefile.mjs`. Generated **`apps-script/Code.gs` now includes `RegionalSnapshots.js`**. The PR workflow also produces a downloadable `b2b-geo-pipeline-codegs` artifact with `Code.gs` and offline copy page.
5. Back up the reporting workbook. In the **Apps Script editor**, install the generated updated Code.gs in the *existing* script project, **not an unrelated deployment**. Before exposing it to the website, **manually run `prepareGeoRegionalSnapshotSchema` exactly once** to create/validate the 50-column technical `Snapshots` tab. It will fail closed if the 8 region report tabs differ.
6. Manually run read-only `debugGeoRegionalSnapshotBinding()` and `debugB2bSheetBindings()`; verify the expected workbook titles and no missing tabs. Do not auto-generate October history from November live data.
7. Deploy an Apps Script **new version of the same web app deployment**, preserving the previous /exec URL and authenticated session behavior. Confirm `doGet` release tag `geo-regional-snapshot-routing-20261101-rc1` and authorized `MonthlySnapshot` GET returns an empty list instead of 503 when no snapshots have actually been recorded.
8. Test with all access roles, especially AE forbidden and SM region-scope, and verify Pipeline CRUD, Event append-only, login, loss/won workflow, historical import. Only after proving read paths should an authorized Admin trigger a **genuine approved new month** capture.
9. Verify counts in `Snapshots` and all 8 tabs, and that every `(Snapshot Period, Opportunity ID)` appears at most once per regional tab. Rows with unrecognized Region remain in canonical history and are **not assigned to a guessed region**.
10. If a valid technical capture exists but a derived region write fails, run `repairGeoRegionalSnapshotProjections()` manually after fixing the cause. This appends only missing pairs; it does not recapture history or overwrite existing rows. The snapshot/audit transaction spans two workbooks and is **not ACID**; reconcile `Admin_Audit` separately if an interrupted scheduled capture leaves an unmatched audit row.


## Historical Import 412-candidate no-damage gate (added from user-approved checklist)

**The Snapshot fix is independent of the Historical Import backend. Passing the Snapshot tests does not authorize importing historical rows.** Historical Import validation is evaluated separately from normal Opportunity Create/Edit. Treat these as blocking acceptance criteria before any production import:

- **AE Owner:** Read the live `AE_Owner_Approval_20261027` and latest approved case records, then bind a source row/code/region/name to a real active AE User ID. Current backend *incorrectly* requires `source_sales_code == Users.employee_id`; sample approved AE-001 and AE-002 deliberately differ. Original code must be recorded unchanged, no synthetic Owner/SM-as-Owner.
- **Business ID:** Accept optional raw 1–40 character values, including repeated IDs across separate customers; the present frontend `legacyBusinessId` and backend import validator still use a digit-only regex. Preserve specific reviewed shifted-column exceptions without silently rewriting source.
- **Stage/status/closure:** Stage 1/2 -> Open, Stage 3 -> Won; approved Cancel -> Lost with exact approved reason. Inactive `STG003` is valid only for verified historical import, not normal Create/Edit. Leave missing approved historical close dates empty; do not date the imported closure to the import timestamp. Original Created Date, Created Month, Stage Entered Date, Monthly Sale Plan and Expected Close Month remain separate.
- **Identity:** One original file row = one Opportunity. Use stable *source file + original row* ID, not customer/product/business-ID similarity. Reconcile collisions against existing Production and within batch before assigning IDs. Existing source identities are skipped; never updated. Run only batches <=200.
- **Preview & authorization:** Require authenticated, permission-scoped, read-only server preflight (statuses `READY`, `ALREADY_IMPORTED`, `HOLD`, `POTENTIAL_DUPLICATE`) and row-specific validation. No Preview writes to Pipelines/Events/Audit; Commit revalidates under lock.
- **P1:** Approved sales-channel/partner, historical region from source workbook filename (not owner), source territory text, mapped customer/product category from live Config plus original raw text, raw Subs/RC/Net RC/OC, numeric warnings separate from blockers, valid Thai/English month and Excel serial conversion at normalization only.
- **412-case reconciliation:** Baseline all **412** migration candidate source identities (416 source rows less four explicitly excluded BMA-West template rows), compare against live technical keys and report `already_imported / ready / hold / collision`, verify pre/post `Pipelines`, `Pipeline_Events`, `Admin_Audit`, statuses/owners/handlers/financials, and final imported/skipped/failed totals. Do not conclude that all 412 need importing or have been imported; some may already be in Production.

### Verified current blockers (2026-11-01)
`server/core.js` still hardcodes the Sales Code-to-Employee ID equality and rejects Business ID characters other than digits. Its import endpoint is an all-or-nothing 409 on known Source IDs; there is no complete read-only server preview with all four statuses. Client `Import.jsx` also enforces Sales Code equality and digit-only Business ID. Approved Historical Stage3/Cancel exemptions are currently bounded by specific Source IDs. These are genuine, separate migration defects; **do not merge this snapshot-only PR as an import fix**.

No data was imported, overwritten, or normalized by this snapshot PR.

## Release safety
- **DO NOT** merge/deploy this branch without CI success and a controlled read-only smoke test.
- No live Sheet has been written or renamed by this branch.
- Do not run `runGeoMonthEndSnapshot()` simply to repair the 503: capturing October from November's live Pipelines is historical falsification.
- Existing 8 region report tabs are left untouched by `prepareGeoRegionalSnapshotSchema`, which only creates the technical tab when absent.
