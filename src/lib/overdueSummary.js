import { isStageSlaOverdue, ageInDays, validSlaDays } from "./dashboardMetrics.js";
import { handlerSlaAlert, workingWithSlaAlerts } from "./alertRules.js";

// Stage Aging remains a display/sort metric, NOT a separate overdue alert.
export function isStageAgingOverdue(op, stageWatchDays = 7, now = new Date()) {
  if (op?.status !== "open") return false;
  const age = ageInDays(op.stage_entered_at, now);
  const watch = validSlaDays(stageWatchDays);
  return age !== null && watch !== null && age > watch;
}

export function currentPipelineTasks(op, taskEntries = []) {
  return (taskEntries || []).filter(t =>
    t.opportunity_id === op.id &&
    t.scenario_id === op.scenario_id &&
    t.stage_id === op.stage_id &&
    t.stage_entered_at === op.stage_entered_at);
}

// Reuse the same context for Pipeline, Dashboard, Kanban, and filters.
export function overdueContext(maps = {}, master = {}, config = {}) {
  return { members: maps?.member || {}, teams: master?.WorkingWithOption || [], config: config || {} };
}

// Old fifth-argument Date is still accepted for existing callers/tests.
// A Pipeline is counted only once even if several alert tags are present.
export function overdueReasons(op, stageMap = {}, stageWatchDays = 7, taskEntries = [], nowOrContext = new Date()) {
  const ctx = nowOrContext instanceof Date ? { now: nowOrContext } : (nowOrContext || {});
  const now = ctx.now || new Date();
  const stageAging = isStageAgingOverdue(op, stageWatchDays, now); // informational only
  // Prefer authenticated Core/Apps Script results computed from live Pipeline
  // and append-only Pipeline_Events; retain backwards-compatible UI fallback.
  const live = op?.alert_state?.version === 1 ? op.alert_state : null;
  const stageSla = live ? live.stageSla === true : isStageSlaOverdue(op, stageMap, now);
  const handler = live ? live.handler : handlerSlaAlert(op, ctx.members, ctx.config, now);
  const workingWithTeams = live ? live.workingWithTeams || []
    : workingWithSlaAlerts(op, ctx.teams, ctx.config?.internal_task_sla_days, now);
  const tasks = op?.status === "open" ? currentPipelineTasks(op, taskEntries) : [];
  const overdueTasks = tasks.filter(t => t.overdue);
  return { stageAging, stageSla, handler, workingWithTeams, overdueTasks,
    overdueTaskCount: overdueTasks.length,
    any: Boolean(stageSla || handler || workingWithTeams.length || overdueTasks.length) };
}

/** Detect incomplete SLA projection on backend-authorized Open records.
 * This is a read-only deployment diagnostic, not a replacement SLA calculator.
 */
export function missingServerSlaCount(opportunities = []) {
  return (opportunities || []).filter(op =>
    op?.status === "open" && op?.alert_state?.version !== 1).length;
}
