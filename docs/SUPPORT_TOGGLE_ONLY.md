# Support workflow: Pipeline flag only (UAT)

## Product decision

The active support workflow is the existing `Pipelines.support_needed` flag.
No ticket queue, assignee, ticket statuses, resolution note, or separate Support
Requests page are required. This removes the duplicate Support navigation and
extra coordination steps for AE / SM / Management.

## User experience

- Sidebar: Dashboard, Pipeline, Assigned to Me (+ Admin and Import by role).
  Remove both `Needs Support` and `Support Requests` from Sidebar.
- Pipeline: retain `Needs Support` quick filter alongside All Open and Assigned
  to Me; deep links `/support-requests` redirect to this filter.
- Pipeline Detail: `Mark Needs Support` or `Remove Needs Support` with a short
  confirmation on removal. When enabling, Support Type and Support Note are
  mandatory; when disabling, clear the current values automatically.
- Edit Pipeline: toggle is reversible; no mandatory ticket resolution.
- Management Dashboard: show Needs Support based on role/Region-scoped open
  Pipelines instead of the retired Ticket queue.

## Backend & authorization

- AE: update own / handled Pipeline per existing server scope.
- SM, Management: update Pipelines within assigned Regions.
- Admin: update all Pipelines.
- Existing Pipeline revision checks and server-side `Pipeline_Events` audit
  apply to every Support flag change. Backend rejects invalid type/note on
  activation and clears them when turning support off.
- Legacy `/support-requests` API returns HTTP 410 (within the existing Apps
  Script envelope). Existing `Support_Requests` sheet is retained unchanged
  for history/rollback, and no new rows are written. Legacy backfill helper is
  disabled. No schema deletion, data backfill, or Sheets mutation needed.

## Rollout

1. Review PR, run lint, tests and frontend build in GitHub Actions.
2. Deploy frontend after merge via GitHub Pages workflow.
3. Run `npm run gas:build` and `npm run gas:push` against existing Apps Script
   project (or use the generated **new** single-file Code.gs artifact).
4. Deploy **New version of the existing Apps Script web-app deployment**. Never
   use the old 2026-10-25 login-only Code.gs release for this change: its core
   includes the retired ticket workflow.
5. Test real UAT access on all 4 roles, including two users in different Regions;
   confirm Off→On→Off, Support Type and Note clearing, History actor/time, and
   that 28 existing flagged Pipelines remain visible in the quick filter.
6. Do not run `backfillGeoPhase4SupportFlags()` or delete the Support_Requests tab.

Notes: A legacy Support Request is not automatically converted to a Pipeline
flag; current canonical UAT data already stores Support Needed on Pipelines.
