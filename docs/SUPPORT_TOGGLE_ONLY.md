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

## Release procedure

Use the single authoritative [Release Runbook](RELEASE_RUNBOOK.md). This file describes **product behavior only**, not a separate deployment workflow. Never run the retired Support Request ticket backfill.
