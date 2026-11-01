# B2B GEO — Historical Migration P0/P1 release gates (2026-11-01)

## Current decision
**DRAFT / NO PRODUCTION COMMIT.** This PR is not a deployment instruction. Do not merge until both this Import PR and the independent regional Snapshot PR have been evaluated together and released in an approved order. The Snapshot repair resolves a different physical-sheet error; it is intentionally not bundled here.

## Read-only source ledger
The latest **412 Full Source Reconciliation (Nov 1)** includes **416** original candidate lines, with **4** approved blank BMA-West template rows excluded, leaving **412** original Excel opportunities. Its static classifications are:
- 122 exact previously imported (old source IDs; verify against current production on every retry).
- 1 WebApp potential duplicate (name similarity only; not an automatic duplicate).
- 289 previously on HOLD. A subsequent static revalidation divides this into **210 DATA_HOLD + 79 PREVIEW_CANDIDATE**.
- **0** have passed an authenticated new-backend preview; **0** have been imported in this PR.

These static counts are checkpoint evidence, not the current live commit/preview result. A separate read-only latest Production read showed **166** Pipelines and **131** with historical import source IDs. Preserve the 35 web-created/no-source Pipelines. The static source file also identifies **9 unmatched Production source references** needing provenance review. Do not assume all 79 static candidates can import.

## Stable identity: 1 Original Excel Row = 1 Opportunity
Original, approved regional workbooks:
- `Pipeline BMA East-2(1).xlsx` => `BMA-E`
- `Pipeline BMA West-2(1).xlsx` => `BMA-W`
- `Pipeline CW-2(1).xlsx` => `CW`
- `Pipeline East(1).xlsx` => `E`
- `Pipeline North(1).xlsx` => `N`
- `Pipeline NE1(1).xlsx` => `NE1`
- `Pipeline NE2(1).xlsx` => `NE2`
- `Pipeline South(1).xlsx` => `S`

A legacy `DOC-...-R...` Source ID can refer to different original physical Excel rows. The 412-line audit identified **3 alias collision groups affecting 6 distinct original opportunities**:
- `DOC-79e97612cde3acfee14cfb26a78e0ddd-R124`: BMA East row **4** and **29**.
- `DOC-79e97612cde3acfee14cfb26a78e0ddd-R125`: BMA East row **5** and **30**.
- `DOC-79e97612cde3acfee14cfb26a78e0ddd-R15`: East row **125** and **149**.

The backend now supports deterministic `ROW|<NORMALIZED ORIGINAL WORKBOOK BASENAME>|Pipeline|<ORIGINAL PHYSICAL ROW>` identities when the input supplies `source_workbook`, `source_sheet="Pipeline"`, and `source_row`. This becomes the technical `source_record_id` and is combined with `source_system` for duplicate checks. The original `DOC-` alias remains in `import_source_legacy_record_id`, and row evidence in `import_source_row`. **Never merge or drop six colliding original rows.** Copy filenames ending `(1)` map to the same canonical workbook but not to a different `-2` source generation.

For pre-existing Production records using an old `DOC-` alias rather than a canonical file-row key, the importer can report `ALREADY_IMPORTED` only when the submitted **reviewed** `matched_production_opportunity_id` is verified against the exact existing Production key. Otherwise report `POTENTIAL_DUPLICATE` and keep Production untouched. No customer-name, Business ID, product, or Stage similarity is a technical duplicate identity.

## Import API
- `POST /imports/preview`: existing signed session and SM/Admin import/create permission required, 1–200 records; returns `READY`, `ALREADY_IMPORTED`, `HOLD`, `POTENTIAL_DUPLICATE`, row-level validation errors, financial warnings; **no** touch/flush/create/events/audit.
- `POST /imports/opportunities`: same validation, requires stable batch ID and signed authorization. Commits only batches without HOLD or intra-batch source identity collision. Already-imported source keys skip without modifying original Production records. Cross-batch retry of the same original Source Key is idempotent.
- Import-only validation is distinct from regular UI Create/Edit. Normal Pipeline business field validation and authentication remain intact.

## P0 technical requirements and manual schema
The existing `Pipelines` sheet needs **14 new additive raw evidence columns** before deploying this version. Editor-only `prepareGeoHistoricalImportColumns()` can add only missing columns after verified DB identity and explicit `GEO_HISTORICAL_IMPORT_SCHEMA_APPROVED=YES`; **make a full workbook backup first**. The script refuses a wrong workbook or malformed Pipeline header. No existing Pipeline/Events/Audit rows are rewritten as part of this manual preparation.

New columns: `import_source_sales_code`, `import_source_subs`, `import_source_oc`, `import_source_business_id`, `import_source_sales_channel`, `import_source_region`, `import_source_stage`, `import_source_workbook`, `import_source_created_at_raw`, `import_source_created_month_raw`, `import_source_closed_at_raw`, `import_source_stage_entered_at_raw`, `import_source_legacy_record_id`, `import_source_row`.

## Preconditions for releasing any 412 batch
1. Snapshot repair separately deployed and confirmed for all roles/permissions, or explicitly kept isolated while safely testing Import; never create a fake historical snapshot.
2. Verify latest live Production Pipeline and Events counts, per-opportunity revisions, source IDs and audit hashes/snapshots; keep an immutable pre-import backup; reconcile all 412 physical source-row identities against it.
3. Independently verify all authoritative AE approvals (including pending AE/SM cases), current active User_Region assignments, live Product, Channel, Customer Type, Stage and Lost Reason config. No AE invention, no SM assigned as owner, no remapping a different Region.
4. Confirm Stage1/2=Open, Stage3=Won even when inactive in current master, Cancel=Lost only with approved reason. Missing actual historic Won/Lost dates remain empty; original created/stage dates remain separate.
5. Supply the canonical workbook+original row metadata in every new 412-preview payload, along with original legacy Source ID and any **reviewed** previously imported Production match. No source field is silently corrected to pass validation.
6. Run **authenticated read-only PREVIEW of all 412** in batches <=200, comparing exactly four statuses. Do not treat static PREVIEW_CANDIDATE as READY. No Preview response is allowed to mutate Pipeline, Events or Audit.
7. Only after explicit release authorization, import APPROVED READY records <=200 per batch. Re-read Production before each batch, skip already-imported, and reconcile imported/skipped/failed per batch and in total. No overwrite of any existing Pipeline, Activity Log or source.
8. Verify Production counts, source keys, open/won/lost/owner/handler, immutable Events and Audit before/after every batch. Stop on any count or integrity anomaly.

## CI / Deployment caveat
Automated tests and the copy-ready Code.gs build are necessary but not sufficient. No live Apps Script /exec request, manual schema migration, Release Tag readback, live signed Preview, Source batch Commit or production integrity comparison has been executed by this Draft PR. Never deploy or import from an unverified or stale Code.gs bundle.
