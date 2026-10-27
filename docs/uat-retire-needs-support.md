# UAT change control — Retire Needs Support (PR #123)

## Decision
Remove Needs Support from the active B2B GEO Pipeline application across AE, SM, Management and Admin.

## Active product behavior (after deployment)
- No Needs Support cards, queue tabs, sort mode, filters, badges, Quick View/Detail actions, Admin Support Type editor, or Import/Export fields.
- Legacy `support=1` links do not create a filtered support view.
- Server rejects new `support_needed`, `support_type`, `support_type_id`, or `support_note` changes through Opportunity create/update with HTTP 410. SupportType and Support_Requests mutations are retired.
- Existing Pipeline CRUD, Stage, Handler, Working With, Won/Lost, role/region scopes stay functional.

## Data preservation / compatibility
- **Do not delete or rename Google Sheets columns, Support_Types, Support_Requests or historical Pipeline_Events.** Keep past data as read-only archival material for rollback and audit.
- Retired Support audit events remain in the source data. HistoryTimeline omits them from the active user-facing history screen; original audit records stay unchanged.
- Historical Pipeline rows can still be edited for unrelated fields without altering legacy Support values.
- The YAML schema retains legacy Support columns and mappings for existing rows. Schema cleanup is out of scope because it is a destructive migration.

## Deployment order and rollback
1. Review risk and obtain UAT-owner approval before merge/deploy; do not release with red CI.
2. Back up/verify key Pipelines and Pipeline_Events (no destructive migration is planned).
3. Merge the PR into main. Confirm the exact resulting commit SHA.
4. Regenerate the standalone Code.gs from the merged source; paste into the existing Apps Script project and deploy **New version** on the existing deployment. No Script Properties changes required.
5. Confirm Cloudflare Pages has built that same frontend commit, either automatically or by explicit build; do not change `VITE_GEO_API_URL`.
6. UAT: verify no Support UI, backend responds 410 to retired mutations, and valid Create/Edit/Stage/Handler/Working With/Won/Lost plus AE/SM/Management/Admin scopes still work.
7. Rollback if required: redeploy the previous Apps Script version AND roll back/redeploy the prior frontend commit; do not reset user credentials or restore stale Google Sheets backups over live Pipelines.

## Risk assessment
**HIGH (cross-layer functionality retirement)**. The code and tests can be prepared safely as a draft PR, but this is not a live deployment until UAT owner approval and two independently verified releases. Prior data loss is not expected because the plan contains no live data writes.
