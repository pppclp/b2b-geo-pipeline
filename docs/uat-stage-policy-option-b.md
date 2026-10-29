# UAT plan — Stage 1–2 for Open work, Won/Lost are statuses (future Stage N ready)

## Confirmed decision / scope
- Stage is workflow progress; **Won, Lost and Archived are separate Pipeline statuses**. Do not use Stage 3 (or any numeric stage) as a synonym for Won.
- The active Open stages come from the existing `Stages` master `active` and `sort_order` / mapped `order`. Do not hard-code 2, 3 or 4 stages in UI or backend.
- Target UAT Master after approved rollout: STG001 and STG002 Active; STG003 and STG004 Inactive. Future new/re-enabled active stages should appear automatically in filters, board, Quick Update and forms.
- Do not delete Stage 3, change any historical `stage_id`, change any `status`, fabricate `won_at`, or run a migration in this PR.

## Read-only data audit (2026-10-29)
- Live Pipeline DB had **159** nonempty records at inspection time.
- **46** Open + STG003 (legacy candidates for manual reconciliation); **1** Won + STG003; **4** Won + STG001/2. Neither group should be auto-modified.
- Won + STG001/2 is valid under the new semantic: Won is independent from Stage. Avoid coercing closed records to STG003.
- Stage 3 Open records require owner review before any change to status or stage. Preserve import/source evidence, existing timestamps, and audit trails.

## UI & backend behavior
- Board columns iterate **all active stages**; minimum readable column width + horizontal scroll already support arbitrary stage counts.
- Open records assigned to an inactive/missing historical Stage remain discoverable in list and the **Historical Stage · รอตรวจสอบ** section of the Board, not silently omitted or added as a third active stage.
- Won/Lost/Archived records in Board filters are displayed separately by status; Won is not a draggable Stage column.
- Quick Update and Edit expose the previous inactive Stage value (read-only in select) so other authorized edits remain possible without rewriting history.
- Create, Stage changes, and trusted historical imports already validate **new** Stage references against active Master values; old unchanged Stage IDs remain valid on existing rows.
- On Reopen of a closed Pipeline in an inactive/missing Stage, SM/Management/Admin must select an **active** Stage. Backend accepts status + one Stage ID + audit reason atomically; both Stage and Status receive server-owned audit events. Reopen with any other changes is still rejected; ownership, permissions, timestamps and revision checks are preserved.
- A future Stage 3/4 appears automatically when Master marks it Active; Won/Lost rules do not change.

## SAFE release checklist (no live writes in this PR)
1. Review PR and green CI/build. Confirm frontend/backend built from identical merged commit.
2. Export/verify read-only backups for current Master Stages + Pipelines + Pipeline_Events. **Do not restore backups over live data** after new user activity.
3. Deploy updated Apps Script generated Code.gs to the **existing** deployment as a new version (this repo may build Code.gs; do not hand-edit generated artifacts).
4. Publish frontend commit to Cloudflare Pages and verify the exact deployed commit.
5. **Only after the frontend/backend version is live and verified**, set the existing Config → Stages row `STG003.active` from `Yes` to `No` once, with audit/approval. Do not delete the row or touch STG001/STG002/STG004.
6. Refresh all roles; verify active UI shows only Stage 1 & 2; the existing 46 Open STG003 records appear in the historical review section. Verify Won shows via status filter (not as a Stage).
7. UAT: new Create, Stage 1→2, Won/Lost, legacy editable notes, Reopen legacy Won to an active Stage, Audit, board/list parity, import restrictions, Region/Owner/Role permissions, and no lost customer records.
8. Separately obtain explicit approval for any historical status/date correction or migration. This PR does not include it.

## Rollback / future Stage 3
- If deployment breaks: use previous Apps Script version and previous Cloudflare frontend version, re-check compatibility, and restore Stage 3 `active` flag to its prior approved value only if rollback calls for it. Do not overwrite live records.
- Re-enabling **STG003** will also make historical Open STG003 records show in the active Stage 3 column again. **Review/reconcile legacy rows first**, or use a newly assigned Stage ID if future Stage 3 has a different business meaning. Keep IDs stable and never silently remap old rows.
- Future Stage 4+ can be activated without frontend layout changes.

## Risk and status
**HIGH** — cross-layer workflow + existing legacy records. Prepare code/tests/PR only. No merge, Apps Script release, Cloudflare deployment, or Google Sheets writes until explicit approval. Live E2E UAT remains pending.
