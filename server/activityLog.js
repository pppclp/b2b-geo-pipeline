// Read-only, permission-scoped team activity feed over existing Pipeline_Events.
// Current user role/region and Pipeline region are used for UAT visibility;
// these are NOT historical actor/region snapshots. Never infer past assignments.
const RETIRED_SUPPORT_TYPES = new Set(["support_on","support_off","SUPPORT_RAISED","SUPPORT_CLEARED"]);
const RETIRED_SUPPORT_FIELDS = new Set(["support_needed","support_type","support_type_id","support_note"]);
const ACTIONS = new Set(["create","stage_change","handler_change","reassign","working_with_change","won","lost","close_month_change","other"]);
const normalizeRole = (role) => String(role || "").trim().toLowerCase();
const bangkokDay = (value) => {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? new Date(ms + 7 * 3600000).toISOString().slice(0,10) : "";
};
const checkDay = (value) => {
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + "T00:00:00Z")) ||
      new Date(value + "T00:00:00Z").toISOString().slice(0,10) !== value) throw Object.assign(new Error("Invalid activity date"),{status:400});
  return value;
};
const cappedInt = (value, fallback, max) => {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(String(value)) || Number(value) > max) throw Object.assign(new Error("Invalid activity page size or offset"),{status:400});
  return Number(value);
};
const kindOf = (event) => ACTIONS.has(String(event.event_type)) ? String(event.event_type) : "other";
const normalize = (v) => String(v || "").trim().toLowerCase();
const safe = (v) => String(v == null ? "" : v);

export function buildTeamActivityLog({ actor, opportunities, events, users, userRegions, filters = {} }) {
  const role = normalizeRole(actor?.role);
  if (!["sm","management","admin"].includes(role)) throw Object.assign(new Error("Activity Log requires SM or Management access"),{status:403});
  const from = checkDay(filters.from || "");
  const to = checkDay(filters.to || "");
  if (from && to && to < from) throw Object.assign(new Error("End date must be after start date"),{status:400});
  const limit = cappedInt(filters.limit,50,100);
  const offset = cappedInt(filters.offset,0,100000);
  const regionFilter = safe(filters.region);
  const actorFilter = safe(filters.actor_id);
  const roleFilter = normalizeRole(filters.role);
  if (roleFilter && !["ae","sm","management","admin"].includes(roleFilter)) throw Object.assign(new Error("Invalid activity role filter"),{status:400});
  const actionFilter = safe(filters.action);
  if (actionFilter && !ACTIONS.has(actionFilter)) throw Object.assign(new Error("Invalid activity action filter"),{status:400});
  const search = normalize(filters.search);
  if (search.length > 120) throw Object.assign(new Error("Activity search is too long"),{status:400});
  if (role === "sm" && roleFilter && roleFilter !== "ae") throw Object.assign(new Error("SM may view AE activity only"),{status:403});
  if (role === "management" && roleFilter && !["ae","sm"].includes(roleFilter)) throw Object.assign(new Error("Management may view AE and SM activity only"),{status:403});
  const permittedRegions = new Set((actor.region_ids || []).map(String));
  // Scope by opportunity records FIRST. No caller-supplied region/actor can expand this set.
  const visible = new Map((opportunities || [])
    .filter(op => role !== "sm" || permittedRegions.has(String(op.region_id)))
    .map(op => [String(op.opportunity_id),op]));
  const userMap = new Map((users || []).map(u=>[String(u.user_id),u]));
  const membership = new Map();
  for (const row of userRegions || []) {
    if (!["yes","true","1"].includes(normalize(row.active))) continue;
    const key = String(row.user_id);
    if (!membership.has(key)) membership.set(key,new Set());
    membership.get(key).add(String(row.region_id));
  }
  const eligible = [];
  for (const event of events || []) {
    if (RETIRED_SUPPORT_TYPES.has(String(event.event_type)) || RETIRED_SUPPORT_FIELDS.has(String(event.field_name))) continue;
    const op = visible.get(String(event.opportunity_id));
    if (!op) continue;
    const user = userMap.get(String(event.actor_user_id));
    if (!user) continue;
    const actorRole = normalizeRole(user.role);
    if (role === "management" && !["ae","sm"].includes(actorRole)) continue;
    if (role === "sm" && (actorRole !== "ae" || !membership.get(String(user.user_id))?.has(String(op.region_id)))) continue;
    const day = bangkokDay(event.event_at);
    if (!day || (from && day < from) || (to && day > to)) continue;
    eligible.push({
      id:safe(event.event_id), opportunity_id:safe(event.opportunity_id),
      customer_name:safe(op.customer_name), region_id:safe(op.region_id),
      actor_id:safe(user.user_id), actor_name:safe(user.display_name || event.actor_name || user.user_id),
      actor_role:actorRole, event_type:safe(event.event_type), action:kindOf(event),
      field:safe(event.field_name), previous_value:safe(event.previous_value),
      new_value:safe(event.new_value), remark:safe(event.remark), event_at:safe(event.event_at),
    });
  }
  const byRegionRole = eligible.filter(e=>(!regionFilter || e.region_id===regionFilter) && (!roleFilter || e.actor_role===roleFilter));
  const peopleMap = new Map();
  for (const e of byRegionRole) peopleMap.set(e.actor_id,{id:e.actor_id,name:e.actor_name,role:e.actor_role});
  const people = [...peopleMap.values()].sort((a,b)=>a.name.localeCompare(b.name));
  const regions = [...new Set(eligible.map(e=>e.region_id))].filter(Boolean).sort();
  const scoped = byRegionRole.filter(e=>(!actorFilter || e.actor_id===actorFilter) &&
    (!actionFilter || e.action===actionFilter) && (!search ||
      [e.opportunity_id,e.customer_name,e.actor_name,e.actor_id,e.event_type,e.remark].some(x=>normalize(x).includes(search))));
  scoped.sort((a,b)=>b.event_at.localeCompare(a.event_at)||b.id.localeCompare(a.id));
  const summary = new Map();
  for (const e of scoped) {
    if (!summary.has(e.actor_id)) summary.set(e.actor_id,{actor_id:e.actor_id,actor_name:e.actor_name,actor_role:e.actor_role,region_id:e.region_id,count:0,uniquePipelines:new Set(),latest:e.event_at});
    const s=summary.get(e.actor_id); s.count++;s.uniquePipelines.add(e.opportunity_id);
    if (s.region_id!==e.region_id) s.region_id="";
  }
  const by_person=[...summary.values()].map(s=>({actor_id:s.actor_id,actor_name:s.actor_name,actor_role:s.actor_role,
    region_id:s.region_id,count:s.count,pipeline_count:s.uniquePipelines.size,latest:s.latest})).sort((a,b)=>b.count-a.count||a.actor_name.localeCompare(b.actor_name));
  return {items:scoped.slice(offset,offset+limit),total:scoped.length,offset,limit,
    next_offset:offset+limit<scoped.length?offset+limit:null,by_person:by_person,people,regions,
    scope_note:"Visibility uses current actor role/region and current Pipeline region; historical assignments are not reconstructed."};
}
