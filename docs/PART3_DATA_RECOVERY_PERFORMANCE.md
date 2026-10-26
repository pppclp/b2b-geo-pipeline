# Part 3 — Data Integrity, Recovery & Performance Review

**Scope:** isolated hardening and regression tests only; no database migration, live data changes, frontend redesign, or backend deployment. Source baseline: `fb862e9e55cb16e4989e6684aa15008660a8ca06` (`main` after PR #82). Part 2 / PR #83 was **still unmerged** at the time this branch was created. This PR deliberately does not include Part 2 or Part 4.

## Confirmed code-level issue and fix

**Partial backup creation can leave an orphan sheet.** In `geoBackups_`, `copyTo` creates a new sheet, but the existing code recorded its name only *after* both `setName` and `hideSheet` succeeded. An exception between those actions could leave a temporary backup containing Pipeline data, outside the tracked cleanup list. The smallest safe fix deletes the actual copied sheet instance when its rename/hide fails, then lets the existing transaction fail closed. The former backups cleanup and WAL marker sequence remain intact.

If deleting the failed copy itself fails, the operation still fails closed and logs an operator-only cleanup warning; no live DB write is attempted. This cannot guarantee safe cleanup during external quota or infrastructure outages.

## Transaction behavior reviewed and synthetic failure injections

The existing GAS script lock serializes incoming requests. Each request caches sheet reads in `SheetStore_.table`. Critical DB writes backup mutable sheets and checkpoint append-only event/audit row counts, write a `prepared` transaction marker, write all dirty critical sheets, flush, and write a `committed` marker. Recovery restores mutable sheets and trims newly appended audit/event rows only if not committed; committed-marker cleanup never rolls back a successful write.

New synthetic tests cover:
1. Pipeline row written, then `Pipeline_Events` write fails: restores prior Pipeline and preexisting events, removes transaction marker/backups, then a separate replay saves once.
2. Event appended but committed-marker write fails: rolls back both Pipeline mutation and new event.
3. Interruption with a `prepared` marker: recovery restores mutable sheet and append checkpoint.
4. Interruption after a `committed` marker: recovery preserves committed Pipeline and new event, cleans backup only.
5. Backup `setName` or `hideSheet` failure: removes orphan copy before live writes.
6. Admin Audit commits, then a separate Master workbook write fails: API surfaces a failure, but Admin Audit remains. This demonstrates a **confirmed architectural cross-workbook consistency limitation**, not an atomic transaction.
7. Mismatched workbook ID in transaction marker: recovery stops rather than modifying a different workbook.

Earlier tests additionally cover: append-only row immutability, missing sheet/schema fail-closed, batched append, create idempotency, import validation/idempotency, 409 stale revision rejection, Pipeline ownership/role/Region scope, and event/history semantics. This PR does not modify those behaviors.

### Important remaining risks (no code change)

- Google Sheets does **not** provide atomic commits across the Master workbooks and Pipeline DB. For Admin master edits, `Admin_Audit` may commit in the Pipeline DB before the Master write fails. The API already returns an error and tells operators to reconcile first. Do **not** auto-retry such an operation without reconciling both sources. Fixing this requires a separately designed, approved compensating workflow and testing.
- A spreadsheet editor or external workflow writing outside the Apps Script `LockService` can bypass its serialization. Production access controls and change management must restrict direct edits.
- Error during restore (quota/network/authorization) can leave the prepared marker and backups for a later retry or authorized manual recovery. Never delete a pending marker or backup without completing a restore verification.
- A committed response lost over the network can cause uncertainty. Existing `client_request_id` and `batch_id` idempotency should be preserved; users must verify writes before retrying. This PR does not modify duplicate detection or client retry behavior.
- No evidence supports reducing global lock scope, making reads lock-free, or replacing backup copies with faster but unverified alternatives. All remain unchanged.

## Performance assessment and reproducible synthetic benchmark

**Confirmed code behavior**:
- The `handle_` critical section takes a **script-global lock for reads and writes**, including data loading, core handlers, and DB flush/recovery.
- `SheetStore_.table` reads the entire used range of each requested tab with `getValues()` on first access per request, then caches it within the request.
- Backend `batch` is limited to at most 30 GET subrequests; the frontend can combine reads in one Apps Script call, but the backend is still under one global lock.
- Mutable critical sheets are backed up using `copyTo` on writes; append-only history uses last-row checkpoints and is not wholly copied.
- Master writes are outside the critical DB transaction and must not be treated as ACID.
- Dashboard aggregates may perform repeated in-memory filtering; without measured GAS latency or quotas, optimizations are only proposals.

**Reproducible synthetic Node benchmark** (no Google API calls or secrets):

```sh
node scripts/benchmark-part3-synthetic.mjs --rows 200 --requests 80 --clients 8
node scripts/benchmark-part3-synthetic.mjs --rows 1000 --requests 100 --clients 10
```

It executes the real shared Core read handlers against synthetic AE/SM/Admin users and synthetic Pipelines, with four workloads: AE-scoped list, SM Region list, Admin all-list, and SM two-request batch. It serializes Node jobs to emulate a single critical section and emits JSON `total_ms`, `p50_ms`, `p95_ms`, and `requests_per_second`. A small smoke test checks output format.

**Not a real Apps Script performance baseline.** The synthetic benchmark **does not measure** Spreadsheet service I/O, real LockService contention, execution quotas, Apps Script cold starts, network redirects, large live audit histories, or end-to-end Dashboard page latency. Do not use its timings as a production capacity promise. For live-capacity signoff, a separately authorized team must use de-identified UAT test copies and monitor per-request lock wait, Google Sheets reads, latency, retries, and failures across representative concurrent users.

## Reviewer checks and deployment

- Verify Node CI `npm run lint`, `node --test tests/*.test.mjs`, `npm run build`.
- Verify `npm run gas:build` and combined `Code.gs` build using a CI-safe placeholder ID configuration; **do not deploy**.
- All failure injection tests are synthetic, in-memory only; none can corrupt actual Sheet records.
- This change touches `apps-script/Main.js` only in backup-copy error cleanup; no `server/core.js`, schema, Net RC, Script Properties, permissions, lock or release-gate change.
- The existing GitHub Pages production publish and GAS deployment are separate; merging this PR **does not update the deployed Apps Script**. Incorporate this backend code only during the future coordinated UAT release, after checking compatibility with Part 2 and other reviewed changes.
- If unmerged, close the PR to roll back the proposed changes. If an authorized future GAS deployment fails, restore the previous **matched approved generated bundle/deployment version** and verify Pipeline/audit integrity against authorized test data; do not remove transaction backups or overwrite current user records.
