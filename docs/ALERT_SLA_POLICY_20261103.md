# B2B GEO Alerts — AE/SM Handler and Per-Team Working With (UAT)

## Alert policy (calendar days; threshold is strictly exceeded)

- Stage 1 / Stage 2 SLA: `Stages.sla_days = 7` for each active stage. Only a Stage SLA Tag is shown.
- Stage Aging: remains visible as age/sort; `stage_watch_days` is legacy reference only; no duplicate Stage Aging Tag or Overdue reason.
- AE Handler: `Aging_Settings.handler_ae_sla_days = 5`.
- SM Handler: `Aging_Settings.handler_sm_sla_days = 5`. Management handlers do not inherit AE/SM thresholds.
- Working With: `Working_With.sla_days` per team, initially 5 days for Pre-sales, Pricer, Product, Fulfilment, Management, Other. `Aging_Settings.internal_task_sla_days` is the fallback for an unset per-team value.
- Scenario Task Overdue: remains tied to task-specific SLA and start policy.
- All visible alert Tags carry ⚠. Multiple tags may be shown on a Pipeline, but Dashboard/Quick View count that Pipeline once.

## Safe timing

- Stage: `stage_entered_at`, reset only on Stage change.
- Handler: `handler_since`, reset only on Current Handler change. Current handler's role determines AE vs SM.
- Working With: individual team start reconstructed from append-only `Pipeline_Events` field `working_with_teams`; team add/re-add resets only that team's timer. Legacy single-primary `working_with_since` is the fallback for that primary team. Non-imported teams present since creation may use genuine creation timestamp when audit history does not indicate a removal.
- If a historical or imported secondary team's start cannot be verified, suppress an overdue alert for that team rather than using another team's timestamp.
- No `Pipelines` column migration, existing Pipeline values/statuses, or historical opportunity updates are required.
- `internal_overdue` filter and combined Overdue use the same per-team clock logic.

## Release

Changes are confined to the existing Pipeline Config workbook and GitHub code branch. Merge/deploy backend and frontend together and verify read-only with realistic AE/SM/team fixtures before enabling user-facing alerts. Updating the Config sheet alone does not deploy code.
