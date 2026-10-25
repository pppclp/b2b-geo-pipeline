// Presentation-only helpers for the Pipeline list and dashboard.
// Never use these display decisions as authorization rules.
export function sortPipelineRows(items, key = "close_month") {
  const rows = [...items];
  const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const oldestStageFirst = (a, b) =>
    (Date.parse(a.stage_entered_at || "") || Infinity) -
    (Date.parse(b.stage_entered_at || "") || Infinity);
  const fallback = (a, b) => String(a.id || "").localeCompare(String(b.id || ""));
  switch (key) {
    case "value_desc": return rows.sort((a, b) => numeric(b.pipeline_value) - numeric(a.pipeline_value) || fallback(a, b));
    case "value_asc": return rows.sort((a, b) => numeric(a.pipeline_value) - numeric(b.pipeline_value) || fallback(a, b));
    case "stage_aging_desc": return rows.sort((a, b) => oldestStageFirst(a, b) || fallback(a, b));
    case "handler_aging_desc": return rows.sort((a, b) =>
      (Date.parse(a.handler_since || "") || Infinity) - (Date.parse(b.handler_since || "") || Infinity) || fallback(a, b));
    case "updated_desc": return rows.sort((a, b) => (Date.parse(b.updated_date || "") || 0) - (Date.parse(a.updated_date || "") || 0) || fallback(a, b));
    case "created_desc": return rows.sort((a, b) => (Date.parse(b.created_date || "") || 0) - (Date.parse(a.created_date || "") || 0) || fallback(a, b));
    case "customer_asc": return rows.sort((a, b) => String(a.customer_name || "").localeCompare(String(b.customer_name || "")) || fallback(a, b));
    case "support_first": return rows.sort((a, b) => Number(Boolean(b.support_needed)) - Number(Boolean(a.support_needed)) || fallback(a, b));
    case "close_month":
    default:
      // Future/unknown months sort last. Within the same month, surface
      // higher-value opportunities, then those longest in their Stage.
      return rows.sort((a, b) =>
        String(a.expected_close_month || "9999").localeCompare(String(b.expected_close_month || "9999")) ||
        numeric(b.pipeline_value) - numeric(a.pipeline_value) ||
        oldestStageFirst(a, b) ||
        fallback(a, b)
      );
  }
}

export function workingWithTeamLabels(opportunity, teamOptions = []) {
  const available = new Map(teamOptions.filter(t => t?.id && t?.name)
    .map(t => [String(t.id), t.name]));
  const ids = String(opportunity?.working_with_team_ids || "")
    .split(",").map(id => id.trim()).filter(Boolean);
  const names = ids.map(id => available.get(id)).filter(Boolean);
  // Support historical single-team data, but never invent a team/tag.
  if (!names.length && opportunity?.working_with) {
    const name = String(opportunity.working_with).trim();
    const found = teamOptions.find(t => String(t?.name || "").trim().toLowerCase() === name.toLowerCase());
    if (found) names.push(found.name);
  }
  return [...new Set(names)];
}

// Working With is inline only when the Pipeline is currently handled by an SM.
// Preserve the underlying collaboration data for the Quick View / detail page.
export function smWorkingWithTeamLabels(opportunity, handler, teamOptions = []) {
  const ownerId = opportunity?.owner_id;
  const handlerId = opportunity?.current_handler_id;
  if (!handlerId || ownerId === handlerId ||
      String(handler?.app_role || "").toLowerCase() !== "sm") return [];
  return workingWithTeamLabels(opportunity, teamOptions);
}

export function regionDisplayContext(opportunities = [], regionMap = {}, selectedRegionId = "", accessibleRegionIds = []) {
  const visible = [...new Set(opportunities.map(o => o.region_id).filter(Boolean))];
  const permitted = [...new Set(accessibleRegionIds.filter(Boolean))];
  const labelFor = (id) => regionMap?.[id]?.name || id;
  if (selectedRegionId) return { label: "Region: " + labelFor(selectedRegionId), showColumn: false, multi: false };
  // A multi-Region "All" view remains multi-Region even when month, stage or
  // search filters temporarily leave only one Region in the visible records.
  // Match the Dashboard and Pipeline; hide the column only on single-Region scope.
  const available = permitted.length ? permitted : visible;
  if (available.length > 1) return { label: "All Regions · " + available.length, showColumn: true, multi: true };
  if (available.length === 1) return { label: "Region: " + labelFor(available[0]), showColumn: false, multi: false };
  return { label: "No matching Regions", showColumn: false, multi: false };
}
