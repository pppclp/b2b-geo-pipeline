/**
 * Presentation-only labels and filter grouping.
 * Never convert these UI labels into sheet/API keys or backend permissions.
 */
export const PIPELINE_FILTER_LABELS = Object.freeze({
  search: "Search",
  created_month: "Created Month",
  close_month: "Expected Close Month",
  region: "Region",
  owner: "AE Owner",
  handler: "Current Handler",
  stage: "Stage",
  status: "Status",
  product_category: "Product Category",
  scenario: "Scenario",
  working_with: "Working With",
  sales_channel: "Sales Channel",
  ccp_check_result: "CCP+ Check",
  sm_info: "Missing SM Info",
  incomplete: "Incomplete Data",
  stuck: "Overdue",
  due_this_month: "Due This Month",
  internal_overdue: "Internal SLA Overdue",
  won_month: "Won Month",
  lost_month: "Lost Month",
  lost_reason: "Lost Reason",
});
export const QUICK_FILTER_KEYS = ["search", "close_month", "product_category", "region", "status"];
export const ADVANCED_FILTER_KEYS = [
  "created_month", "owner", "handler", "working_with",
  "stage", "scenario", "sales_channel",
  "ccp_check_result", "incomplete", "sm_info",
];

export const DEFAULT_PIPELINE_FILTERS = Object.freeze({status: "open"});

export function isActiveFilter(key, value) {
  if (value == null || value === "") return false;
  if (key === "status" && value === "open") return false; // role default
  return true;
}

export function visibleActiveFilters(filters) {
  return Object.entries(filters || {}).filter(([key, value]) =>
    isActiveFilter(key, value) && key in PIPELINE_FILTER_LABELS
  );
}

export function advancedFilterCount(filters) {
  // Product Category is visible in the primary bar for every role.
  // AE Owner is always advanced for roles authorized to filter by owner.
  return ADVANCED_FILTER_KEYS.filter((key) =>
    isActiveFilter(key, filters?.[key])
  ).length;
}

export function matchesPipelineSearch(op, query) {
  const q = String(query || "").trim().toLocaleLowerCase();
  if (!q) return true;
  return [op?.customer_name, op?.business_id, op?.id, op?.opportunity_id]
    .some((value) => String(value || "").toLocaleLowerCase().includes(q));
}

export function showQuickRegion(profile) {
  if (!profile) return false;
  const regionIds = profile.region_ids || [];
  if (profile.app_role === "ae" || profile.app_role === "sm")
    return regionIds.length > 1;
  return ["management", "admin"].includes(profile.app_role);
}

export function showQuickOwner(profile) {
  return !!profile && ["management", "admin"].includes(profile.app_role);
}

export function allowedAeOwners(members, scopedOpportunities, regionId) {
  const visibleOwnerIds = new Set(
    (scopedOpportunities || [])
      .filter((o) => !regionId || o.region_id === regionId)
      .map((o) => o.owner_id)
  );
  return (members || [])
    .filter((m) => m.active && m.app_role === "ae" &&
      (!regionId || (m.region_ids || []).includes(regionId)) &&
      visibleOwnerIds.has(m.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function shouldClearOwnerOnRegionChange(ownerId, regionId, members, scopedOpportunities) {
  return !!ownerId && !!regionId &&
    !allowedAeOwners(members, scopedOpportunities, regionId).some((m) => m.id === ownerId);
}
