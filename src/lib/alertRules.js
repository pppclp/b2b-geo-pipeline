// Shared non-mutating SLA policies. An unknown clock never triggers an alert.
import { ageInDays, validSlaDays } from "./dashboardMetrics.js";

const selectedIds = (value) => String(value || "").split(",").map(x => x.trim()).filter(Boolean);

export function handlerSlaAlert(op, members = {}, config = {}, now = new Date()) {
  if (op?.status !== "open" || !op.current_handler_id) return null;
  const role = String(members?.[op.current_handler_id]?.app_role || "").toLowerCase();
  if (role !== "ae" && role !== "sm") return null;
  const limit = validSlaDays(role === "ae" ? config.handler_ae_sla_days : config.handler_sm_sla_days);
  const age = ageInDays(op.handler_since, now);
  if (limit === null || age === null || age <= limit) return null;
  return { role, age, limit, overdueDays: age - limit };
}

export function workingWithSlaAlerts(op, teams = [], defaultDays = null, now = new Date()) {
  if (op?.status !== "open") return [];
  const byId = new Map((teams || []).map(t => [String(t.id), t]));
  const ids = selectedIds(op.working_with_team_ids);
  const primary = String(op.working_with_primary_id || op.working_with_id || "");
  if (!ids.length && primary) ids.push(primary);
  if (!ids.length && op.working_with) {
    const legacy = (teams || []).find(t => String(t.name || "").toLowerCase() === String(op.working_with).toLowerCase());
    if (legacy) ids.push(String(legacy.id));
  }
  const since = op.working_with_team_since && typeof op.working_with_team_since === "object"
    ? op.working_with_team_since : {};
  return [...new Set(ids)].flatMap(id => {
    const team = byId.get(id);
    if (!team) return [];
    const limit = validSlaDays(team.sla_days) ?? validSlaDays(defaultDays);
    // Only the legacy PRIMARY team can use the single-team timestamp.
    // For any other team, require a verified timestamp from backend audit history.
    const started = since[id] || (primary === id ? op.working_with_since : "");
    const age = ageInDays(started, now);
    if (limit === null || age === null || age <= limit) return [];
    return [{ id, name: team.name, age, limit, overdueDays: age - limit }];
  });
}
