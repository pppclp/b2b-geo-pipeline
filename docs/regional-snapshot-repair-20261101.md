# B2B GEO — Regional Snapshot Storage Repair (2026-11-01)

## Diagnosis (verified against live Google Sheets)
- Existing `B2B_GEO_Pipeline_DB` (ID `1z2alvS2BSRCll-6CaQq2HetuVCjYW43cpdSuXTZNthc`) **no longer has `Snapshots`**.
- The legacy contract intentionally exposes the **API entity** `MonthlySnapshot` backed by the **physical tab** `Snapshots`. These names are not interchangeable.
- The new `B2B_GEO_Regional_Reporting_Snapshots` (ID `1lYwJnEChx_Lzp9O9_1G4mJSJp1AhGHqKPEYSlcZDtrY`) contains eight **empty** regional presentation tabs with exactly 30 different display columns. It has no technical `Snapshots` tab.
- `503 REQUIRED_SHEET_MISSING` originates from the old Apps Script `SheetStore_.table()` lookup for `B2B_GEO_Pipeline_DB.xlsx / Snapshots`, not from a client-side UI bug.

## Safe architecture
Keep **one canonical technical `Snapshots` tab** in the reporting workbook, with the former 49 technical headers and one appended `working_with_id` field (50 total). Keep eight existing 30-column region tabs as derived, append-only views.

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
| 10 | Sales Code | `owner_sales_code`, preserved as text |
| 11 | AE Name | `owner_sale_name` |
| 12 | Sales Channel | `sales_channel` |
| 13 | Partner Name | `partner_name` |
| 14 | Region | `region_id` resolved via approved 8-region ID map |
| 15 | Province / Territory | `customer_location_text`, else `territory_id` |
| 16 | Product Category | `product_category_id` -> Config Product_Categories.category_name |
| 17 | Product Details | `product_details` |
| 18 | Subs | `quantity` |
| 19 | RC | `import_source_rc` when present, else `price_per_sub`; historical raw Net RC kept separately |
| 20 | Net RC | `pipeline_value` (canonical calculated amount at capture) |
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

**Important semantics:** RC of migrated records can mean a historical source amount, while new records use per-sub pricing. Labeling should be reviewed by Finance before using the regional report as a financial reconciliation; canonical `pipeline_value`, `import_source_rc`, `import_source_net_rc` remain separate. No source value is inferred from a later state.

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

## Release safety
- **DO NOT** merge/deploy this branch without CI success and a controlled read-only smoke test.
- No live Sheet has been written or renamed by this branch.
- Do not run `runGeoMonthEndSnapshot()` simply to repair the 503: capturing October from November's live Pipelines is historical falsification.
- Existing 8 region report tabs are left untouched by `prepareGeoRegionalSnapshotSchema`, which only creates the technical tab when absent.
