/**
 * Stage and Action SLA configuration.
 * Action SLA rows describe planned internal work. They do not start a timer:
 * actual work instances / timestamps must exist before an Action SLA alert.
 */
export function getStageSla(stageId, stageRules = [], fallbackDays = 14) {
  const threshold = Number(fallbackDays);
  const fallback = Number.isFinite(threshold) && threshold > 0 ? threshold : 14;
  const row = stageRules.find((rule) => rule.active && rule.stage_id === stageId);
  const days = row?.sla_days === "" || row?.sla_days == null ? NaN : Number(row?.sla_days);
  if (row && Number.isInteger(days) && days > 0 && row.day_type === "calendar") {
    return { days, source: "stage" };
  }
  // Do NOT run a business-day SLA with calendar-day arithmetic: a corporate
  // holiday calendar is needed before it can be marked overdue accurately.
  if (row && Number.isInteger(days) && days > 0 && row.day_type === "business") {
    return { days: null, source: "pending_business_calendar" };
  }
  return { days: fallback, source: "global" };
}

export function isStageOverdue(op, stageRules = [], fallbackDays = 14, agingDaysFn) {
  if (!op || op.status !== "open") return false;
  const rule = getStageSla(op.stage_id, stageRules, fallbackDays);
  return rule.days !== null && Number(agingDaysFn(op.stage_entered_at)) > rule.days;
}

export function optionsForField(options = [], fieldKey, fallback = []) {
  const configured = options
    .filter((option) => option.active && option.field_key === fieldKey)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((option) => ({ value: option.value, label: option.label || option.value }));
  return configured.length ? configured : fallback.map((value) =>
    typeof value === "string" ? { value, label: value } : value
  );
}
