/**
 * Server-owned read-only SLA projection for EVERY authorized Pipeline.
 * Sources: Pipelines, Pipeline_Events, Users, Stages, Working_With, Aging_Settings.
 * Pure functions: never mutate records, event history, masters or timestamps.
 */
const dayLimit = value => {
  if (value === "" || value == null) return null;
  const num = Number(value);
  return Number.isInteger(num) && num >= 1 && num <= 365 ? num : null;
};
const elapsed = (timestamp, now) => {
  if (!timestamp) return null;
  const start = Date.parse(timestamp);
  const end = Date.parse(now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
  return Math.floor((end - start) / 86400000);
};
const tokens = value => String(value || "").split(",").map(x => x.trim()).filter(Boolean);

function teamIndex(teams) {
  const byId = new Map();
  const byName = new Map();
  for (const team of teams || []) {
    const id = String(team.team_id || team.id || "").trim();
    const name = String(team.team_name || team.name || "").trim();
    if (!id) continue;
    byId.set(id, { id, name, sla_days: team.sla_days });
    if (name) byName.set(name.toLowerCase(), id);
  }
  return { byId, byName };
}
function teamIds(value, index) {
  return [...new Set(tokens(value).map(x =>
    index.byId.has(x) ? x : index.byName.get(x.toLowerCase()) || ""
  ).filter(Boolean))];
}

/**
 * Return confirmed membership start times, team by team.
 * Each team resets ONLY on its own add/re-add event in Pipeline_Events.
 * Legacy PRIMARY-team `working_with_since` remains a trusted fallback.
 * No start is inferred for unknown historical secondary memberships.
 */
export function workingWithStartByTeam(op, events = [], teams = []) {
  const index = teamIndex(teams);
  const primary = String(op?.working_with_primary_id || op?.working_with_id || "").trim();
  let selected = teamIds(op?.working_with_team_ids, index);
  if (!selected.length && primary && index.byId.has(primary)) selected = [primary];
  if (!selected.length && op?.working_with) selected = teamIds(op.working_with, index);
  if (!selected.length) return {};

  const starts = new Map();
  const relevant = (events || []).filter(e =>
    String(e.opportunity_id) === String(op.id || op.opportunity_id) &&
    ["working_with_teams", "working_with"].includes(String(e.field_name)) &&
    Number.isFinite(Date.parse(e.event_at))
  ).sort((a,b) => Date.parse(a.event_at) - Date.parse(b.event_at) ||
    String(a.event_id || "").localeCompare(String(b.event_id || "")));
  for (const event of relevant) {
    const prior = new Set(teamIds(event.previous_value, index));
    const next = new Set(teamIds(event.new_value, index));
    for (const id of prior) if (!next.has(id)) starts.delete(id);
    for (const id of next) if (!prior.has(id)) starts.set(id, event.event_at);
  }
  const out = {};
  for (const id of selected) {
    if (starts.has(id)) out[id] = starts.get(id);
    else if (id === primary && op?.working_with_since &&
      Number.isFinite(Date.parse(op.working_with_since))) out[id] = op.working_with_since;
  }
  return out;
}

export function livePipelineAlertState(op, {
  stages = [], users = [], teams = [], settings = {}, teamStarts = {}, now = new Date(),
} = {}) {
  const state = { version: 1, stageSla: false, handler: null, workingWithTeams: [] };
  if (String(op?.status || "").toLowerCase() !== "open") return state;
  const start = op.stage_entered_at;
  const stage = (stages || []).find(s => String(s.stage_id || s.id) === String(op.stage_id));
  const stageLimit = dayLimit(stage?.sla_days);
  const stageAge = elapsed(start, now);
  state.stageSla = stageLimit !== null && stageAge !== null && stageAge > stageLimit;

  const handlerId = String(op.current_handler_id || op.current_handler_user_id || "");
  const user = (users || []).find(u => String(u.user_id || u.id) === handlerId);
  const role = String(user?.role || user?.app_role || "").toLowerCase();
  const handlerLimit = dayLimit(role === "ae" ? settings.handler_ae_sla_days
    : role === "sm" ? settings.handler_sm_sla_days : null);
  const handlerAge = elapsed(op.handler_since, now);
  if (handlerLimit !== null && handlerAge !== null && handlerAge > handlerLimit) {
    state.handler = { role, age: handlerAge, limit: handlerLimit, overdueDays: handlerAge - handlerLimit };
  }

  const index = teamIndex(teams);
  for (const [id, since] of Object.entries(teamStarts || {})) {
    const team = index.byId.get(id);
    if (!team) continue;
    const limit = dayLimit(team.sla_days) ?? dayLimit(settings.internal_task_sla_days);
    const age = elapsed(since, now);
    if (limit !== null && age !== null && age > limit) {
      state.workingWithTeams.push({
        id, name: team.name, age, limit, overdueDays: age - limit,
      });
    }
  }
  return state;
}
