// Scenario × Stage task scheduling. No invented SLA or implicit task completion.
// A task begins at Stage entry only when explicitly configured stage_entry.
// "after_previous" begins when the previous ordered task is actually completed.
export const daysBetween = (since, now) => {
  if (!since) return null;
  const a = new Date(since).getTime(), b = new Date(now).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.floor((b - a) / 86400000) : null;
};
export const validDays = (n) => n !== "" && n != null && Number.isInteger(Number(n))
  && Number(n) >= 1 && Number(n) <= 365 ? Number(n) : null;
export const activeTask = (value) => /^(yes|true|1)$/i.test(String(value ?? ""));
export function elapsedTaskDays(since, until, dayType = "calendar") {
  if (!since) return null;
  if (dayType !== "business") return daysBetween(since, until);
  const start = Date.parse(since), end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  // Weekdays only; Thai public holidays are NOT excluded without an approved calendar.
  // Constant-time calculation avoids iterating through years of task history.
  const fullDays = Math.floor((end - start) / 86400000);
  const weeks = Math.floor(fullDays / 7);
  const remainder = fullDays % 7;
  const startDay = new Date(start).getUTCDay();
  let weekdays = weeks * 5;
  for (let day = 1; day <= remainder; day++) {
    const weekday = (startDay + day) % 7;
    if (weekday !== 0 && weekday !== 6) weekdays += 1;
  }
  return weekdays;
}
export function pipelineTaskViews(opportunity, templates, instances, now = new Date().toISOString()) {
  if (!opportunity || !opportunity.scenario_id || !opportunity.stage_id) return [];
  const matches = (templates || []).filter(t => activeTask(t.active) &&
    t.scenario_id === opportunity.scenario_id && t.stage_id === opportunity.stage_id)
    .sort((a,b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) ||
      String(a.task_id).localeCompare(String(b.task_id)));
  const current = (instances || []).filter(r => r.opportunity_id === opportunity.opportunity_id &&
    r.stage_entered_at === opportunity.stage_entered_at &&
    r.stage_id === opportunity.stage_id && r.scenario_id === opportunity.scenario_id);
  let previous = null;
  return matches.map(template => {
    const saved = current.find(r => r.task_id === template.task_id);
    const policy = template.start_policy || "manual";
    let startedAt = saved?.started_at || "";
    if (!startedAt && !saved && policy === "stage_entry") startedAt = opportunity.stage_entered_at || "";
    if (!startedAt && !saved && policy === "after_previous" && previous?.status === "done")
      startedAt = previous.completed_at || "";
    const status = saved?.status || (startedAt ? "in_progress" : "not_started");
    const limit = validDays(template.sla_days);
    const elapsed = status === "in_progress" ? elapsedTaskDays(startedAt, now, template.day_type) : null;
    const breached = String(opportunity.status).toLowerCase() === "open" &&
      status === "in_progress" && limit !== null && elapsed !== null && elapsed > limit;
    const item = {
      opportunity_id:opportunity.opportunity_id, task_id:template.task_id, task_name:template.task_name,
      scenario_id:template.scenario_id, stage_id:template.stage_id, stage_entered_at:opportunity.stage_entered_at,
      sort_order:Number(template.sort_order || 0), working_with_id:template.working_with_id || "",
      start_policy:policy, day_type:template.day_type || "calendar",
      sla_days:limit, status, started_at:startedAt,
      completed_at:saved?.completed_at || "", updated_at:saved?.updated_at || "",
      overdue:breached, overdue_days:breached ? elapsed-limit : 0,
    };
    previous = item;
    return item;
  });
}
