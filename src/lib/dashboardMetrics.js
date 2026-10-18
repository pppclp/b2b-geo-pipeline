// Shared Dashboard and Pipeline SLA definitions.
// Cohort filters apply to every KPI, chart and drill-down before status filtering.
import { monthOf } from "./pipeline.js";
export { monthOf } from "./pipeline.js";

export function dashboardCohort(opportunities, { createdMonth = "", closeMonth = "", region = "" } = {}) {
  return opportunities.filter((o) =>
    (!createdMonth || (o.created_month || monthOf(o.created_date)) === createdMonth) &&
    (!closeMonth || o.expected_close_month === closeMonth) &&
    (!region || o.region_id === region)
  );
}

export function validSlaDays(value) {
  if (value === "" || value === null || value === undefined) return null;
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : null;
}

export function ageInDays(since, now = new Date()) {
  if (!since) return null;
  const t = new Date(since).getTime();
  const n = new Date(now).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null;
  return Math.max(0, Math.floor((n - t) / 86400000));
}

export function isStageSlaOverdue(op, stages, now = new Date()) {
  if (op.status !== "open") return false;
  const stage = stages?.[op.stage_id];
  const limit = validSlaDays(stage?.sla_days);
  const elapsed = ageInDays(op.stage_entered_at, now);
  return limit !== null && elapsed !== null && elapsed > limit;
}

// Internal work is measured from Working With start, independently of Stage
// entered / Handler clocks. No active team or missing timestamp = no overdue.
export function isInternalSlaOverdue(op, days, now = new Date()) {
  if (op.status !== "open" || !op.working_with) return false;
  const limit = validSlaDays(days);
  const elapsed = ageInDays(op.working_with_since, now);
  return limit !== null && elapsed !== null && elapsed > limit;
}

export function dashboardMetrics(cohort, { stages = {}, internalTaskSlaDays = null, now = new Date() } = {}) {
  const created = cohort; // ALL statuses, not just Open.
  const open = cohort.filter((o) => o.status === "open");
  const expected = open.filter((o) => Boolean(o.expected_close_month));
  const won = cohort.filter((o) => o.status === "won");
  const lost = cohort.filter((o) => o.status === "lost");
  return {
    created, open, expected, won, lost,
    supportNeeded: open.filter((o) => o.support_needed),
    stageOverdue: open.filter((o) => isStageSlaOverdue(o, stages, now)),
    internalOverdue: open.filter((o) => isInternalSlaOverdue(o, internalTaskSlaDays, now)),
  };
}
