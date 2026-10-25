# Operational acceptance evidence — required before Production

This is a **test protocol**, not a claim that live UAT/Production tests passed. Use only authorized, synthetic or approved de-identified data. Do not put any real workbook URLs, private identifiers, tokens or passwords in public GitHub.

## 1. Load/concurrency rehearsal (Release Owner + UAT accounts)
- Provision distinct AE/SM/Management/Admin test accounts and seed a representative copy of expected Pipeline, Event and Snapshot volumes.
- Measure load as 1, 5, 10, 20, and 30 **concurrent users**, or the approved actual peak if higher, including Dashboard refresh, Pipeline List, create, stage/handler handoff, and 100–200 row import.
- Record 50th/95th/99th percentile request latency, number of timeout/429/503, lock waits, last successfully committed Pipeline ID, Apps Script quotas, and time to recover.
- Confirm `LockService.waitLock(30000)` does not create unacceptable blocking under load. If it does, redesign critical sections or move to a transactional backend; don't remove locks without safe crash recovery.
- Verify concurrent edits on the same Pipeline generate exactly one successful revision; the loser sees 409 and no duplicate audit event.

## 2. Backup and restore — TEST COPY ONLY
- Capture a restricted backup including Pipelines, Pipeline_Events, Snapshots, Admin_Audit, Config and User/Region mapping before tests.
- Restore a **separate isolated test copy**; never overwrite the canonical UAT/prod workbook as part of a rehearsal.
- Compare row counts, distinct keys, per-Region and per-month Net RC totals (subject to business sign-off), recent Event audit IDs and active/notified handoffs. Validate no duplicate create/import batch IDs.
- Inject one simulated failure after a Pipeline row change but before Event append. Verify backup transaction marker and rollback return the test copy to a consistent state.
- Record evidence for restore point/time and who is authorized to operate recovery. Never delete recovery-marker/backup tabs until integrity is confirmed.

## 3. Alerting and on-call ownership
- UAT backend currently logs structured API errors with a support `error_id`. Elevated global login failures emit `UAT_SECURITY_ALERT` **without globally locking accounts**. Scheduled snapshot emits a server-owned audit event `SNAPSHOT_AUTO_CAPTURE` with actor `SYSTEM_MONTH_END`.
- Configure the approved Apps Script / Cloud Logging alert integration (or enterprise monitoring service) for repeated 5xx/503, login spray indicators, script quota and lock wait failures, and scheduled trigger executions that fail or do not produce an audit event on first-of-month.
- Assign an incident owner, response channel, notification rules, escalation and secret rotation procedure. Alert delivery must be **proven** through a test event; writing `console.error` alone is not monitoring completion.
- Do not export raw request bodies, employee ID, session tokens or customer details to public logs or GitHub.

## 4. Release evidence and business decisions
- Freeze PR scope, tag both frontend commit and matching GAS build/version **after** approval, capture authorized rollback metadata and disable automatic Pages deployment.
- Obtain Business Sign-off in `FINANCIAL_FIELD_SIGNOFF.md` for RC/Net RC/OC/Monthly Sale Plan, Customer Type `Industrial`, exact Business ID types and whether an AE Working With relationship grants **personal** read-only access (it currently does not).
- Run complete representative Import with original leading-zero Business IDs, styled blank XLSX rows, missing contacts and Net RC source references. Reject partial/ambiguous imports.
- Record UAT results signed by Business Owner and IT/Security/Privacy as applicable. No real customer data before authorization.

**Current status:** awaiting authorized runtime load/restore tests and external approvals. Track in [Issue #69](https://github.com/pppclp/b2b-geo-pipeline/issues/69) and the [release runbook](RELEASE_RUNBOOK.md).
