import { isStageSlaOverdue, ageInDays, validSlaDays } from "./dashboardMetrics.js";

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

// Each Pipeline is returned at most once in the combined Overdue view.
export function overdueReasons(op, stageMap = {}, stageWatchDays = 7, taskEntries = [], now = new Date()) {
  const stageAging = isStageAgingOverdue(op, stageWatchDays, now);
  const stageSla = isStageSlaOverdue(op, stageMap, now);
  const tasks = op?.status === "open" ? currentPipelineTasks(op, taskEntries) : [];
  const overdueTasks = tasks.filter(t => t.overdue);
  return { stageAging, stageSla, overdueTasks, overdueTaskCount: overdueTasks.length,
    any: stageAging || stageSla || overdueTasks.length > 0 };
}
