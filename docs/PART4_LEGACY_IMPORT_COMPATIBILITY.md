# Part 4 — Legacy Import Compatibility Review

## Baseline and source relationship
- Latest `main` when work began: `64c1720eecfcfc789a46529cbafe9b914ba1a5a5` (includes merged Part 5 / PR #85).
- Draft PR #72 is **not merged**. Its historical base (`56b1166686c2376cdabca259f17389b04b84a021`) predates current import/API validation and CI. This PR selectively reimplements the missing legacy month behavior rather than cherry-picking PR #72.
- The last verified Pages deploy job remains the pinned recovery flow run `40252003479`; the later normal workflow for `fb862e9` ran preflight only. Never assume current `main` is live Pages content.
- The real deployed Google Apps Script version remains **unverified**; generated Code.gs artifacts are only build outputs, not evidence of deployment.

## Before / after compatibility matrix

| Case | main before Part 4 | New Part 4 candidate |
|---|---|---|
| Unmapped modern import (no Create Month) | Backend uses server Bangkok month | Same behavior |
| Legacy Create Month / Created Month | Not recognized; source month discarded | Explicitly mapped; strict parsing to YYYY-MM, saved as `Pipelines.created_month` |
| Excel date typed cell | Parsed to ISO source date string | Strict parser extracts YYYY-MM |
| Excel text dates | Read as string | Accept unambiguous YYYY-MM, YYYY-MM-DD, `1-Jul-26`, `Jul-26` |
| Invalid date / ambiguous day-month order | No source-month validation | Rejected in Preview (and backend rejects invalid direct import month) |
| Duplicate recognized source headers | Header mapper refuses automatic selection, but old import could silently ignore month | Requires explicit manual column mapping; rejects until selected |
| Mapped blank historical month | No Create Month field | Rejected; user must supply source date or explicitly skip mapping for a file with no recognized source column |
| Excel unformatted numeric serial | Read as number/text | Rejected as ambiguous; **never** guess Excel epoch |
| Business IDs with leading zeros | Existing Excel number format reconstructs standard all-zero padded identifiers | Preserved unchanged; no leading zero guessing for damaged IDs |
| Import only historical month | Unsupported | Trusted server `imports/opportunities` path with SM/Admin and existing import permission |
| Browser normal Create/Edit spoof | `created_month` already system-controlled | Both `created_month` and `source_created_month` stripped |
| `created_at` & `event_at` | Server-owned timestamps | Server-owned timestamps, unchanged |
| Same batch retry | Signature of commercial fields | New signature includes source month; old signature still valid for legacy retries |
| Cross-batch duplicate with different historical month | Commercial signature detects duplicate | Still detects duplicate independent of imported month |
| Existing Import UI | Upload → Map → Preview → Confirm | Same layout and flow; optional mapping field and Preview month cell only |
| Customer Type values | Current `pipelineValidation.js` legacy 7 groups | **Intentionally unchanged pending approved taxonomy decision** |
| Net RC | Server existing financial formula | Unchanged |

## Verified configuration discrepancy (read-only)
Current Google Sheet `B2B_GEO_Pipeline_Config` → `Field_Options` lists seven **active** `customer_type` options:
`CP GROUP AND TECH`, `ENERGY AND GROWTH`, `FINANCIAL SERVICES AND INSURANCE`, `HEALTH AND EDUCATION`, `MANUFACTURING INDUSTRIAL AND PROPERTY`, `PUBLIC`, `SERVICE AND RETAIL`.

Current repository `src/lib/pipelineValidation.js` instead accepts:
`Government`, `Enterprise`, `Industrial`, `SME`, `Education`, `Telco`, `Other`.

**Do not silently substitute the seven new groups into code:** existing creation, import, data history and validation rules use the legacy types; the correct migration/acceptance policy, permitted synonyms and whether both lists should be supported are not formally confirmed by the business owner. No taxonomy rewrite, automatic historical reclassification or Sheet edits in Part 4. The release owner must approve classification policy and validate source mappings before real legacy imports.

## Implementation scope (all source only)
- `src/lib/importHeaderMapping.js`: aliases for existing historical Create Month header variants and fail-closed detection of unmapped/ambiguous source column.
- `src/lib/importWorkbook.js`: strict date parser, no locale-dependent guesswork. ExcelJS already converts actual typed Excel date cells to ISO strings in its existing `excelCellText`.
- `src/pages/Import.jsx`: optional historical month mapping, Preview display and row-level invalid/blank feedback; retains existing Import navigation and financial calculation.
- `server/opportunityPolicy.js`: ordinary Create/Edit strips import-only `source_created_month`.
- `server/core.js`: preserve source month only with trusted internal importMeta; validate 1900–2100 and YYYY-MM; server timestamps remain actual; preserve legacy batch signatures and commercial dedupe across month differences. No schema changes, lock revisions or Net RC changes.
- Tests use only synthetic in-memory store and self-made Excel workbooks; no actual imports or live Sheets updates.

## Safe rollout and rollback
1. Merge only after CI and source-review signoff. The backend import contract is extended; **do not publish new Import frontend on an older Apps Script bundle**. The Pages release gate should require manual `backend_verified` verification because backend and import files changed.
2. At the end of all approved Parts, produce **one combined Code.gs** from the same exact reviewed branch/commit, verify it in isolated UAT, then perform the existing coordinated backend + frontend release (do not deploy here).
3. In approved UAT, test synthetic modern and legacy imports for AE/SM/Admin permissions, stage/region references, date/zero preservation, business taxonomy, rejection of duplicate and stale batches, and event timestamps. Do not run historical production imports.
4. Rollback before merge: close this PR. After merge, revert this PR if incompatible. After a future deployment, restore the last approved paired frontend/backend versions and verify existing records and Audit; **never overwrite canonical Sheets or run setup()** to roll back an import change.

## Known limitations
- 2-digit English years use the conservative PR #72 legacy convention: `00–69→2000–2069`, `70–99→1970–1999`; any different business century rule requires approval.
- Text `01/07/26` is ambiguous and intentionally rejected. Unformatted Excel serial numbers are ambiguous and rejected. Thai Buddhist calendar and other locales require a separate approved specification.
- Old imported batches with only commercial signatures cannot retrospectively detect a changed historical month on retry; these batches return their existing IDs without any data rewrite.
- No Browser-based preview UAT, real Google Sheets permission verification, live Apps Script version verification or actual imports were run.
