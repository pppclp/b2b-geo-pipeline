// Read-only presentation metadata for the Pipeline page.
// Filter values are derived from *server-scoped* opportunities, never a global
// User Master list; authorization remains entirely on the backend.
export const ROLE_FILTERS = Object.freeze({
  ae: {
    primary: ["status", "close_month", "stage"],
    more: ["created_month", "product_category", "sales_channel", "support", "stuck", "internal_overdue"],
  },
  sm: {
    primary: ["status", "close_month", "stage", "owner", "region"],
    more: ["handler", "product_category", "sales_channel", "working_with", "scenario",
      "ccp_check_result", "needs_review", "created_month", "support", "stuck", "internal_overdue"],
  },
  management: {
    primary: ["status", "close_month", "stage", "region", "owner", "product_category", "sales_channel"],
    more: ["handler", "working_with", "scenario", "ccp_check_result",
      "created_month", "support", "stuck", "internal_overdue"],
  },
  admin: {
    primary: ["status", "close_month", "stage", "region", "owner", "product_category", "sales_channel"],
    more: ["handler", "working_with", "scenario", "ccp_check_result", "needs_review",
      "created_month", "support", "stuck", "internal_overdue"],
  },
});

export const FILTER_LABELS = Object.freeze({
  status: "Status", close_month: "Expected Close", created_month: "Created Month",
  stage: "Stage", owner: "Owner (AE)", handler: "Handler", region: "Region",
  product_category: "Category", sales_channel: "Sales Channel",
  working_with: "Working With", scenario: "Scenario", ccp_check_result: "CCP+ Check",
  support: "Support", stuck: "Stage SLA Overdue", internal_overdue: "Internal SLA Overdue",
  needs_review: "Pending SM Review",
});

const optionFields = Object.freeze({
  region: ["region_id", "region"],
  owner: ["owner_id", "member"],
  handler: ["current_handler_id", "member"],
  stage: ["stage_id", "stage"],
  product_category: ["product_category_id", "category"],
  sales_channel: ["sales_channel", null],
  scenario: ["scenario_id", "scenario"],
  ccp_check_result: ["ccp_check_result", null],
  working_with: ["working_with", "workingWith"],
});

export function visibleFilterFields(role, regionIds = []) {
  const layout = ROLE_FILTERS[role] || ROLE_FILTERS.ae;
  // SMs assigned to one Region should not need a Region selector; unlike
  // other fields, this is an actual permission-scoped structural invariant.
  const showRegion = role !== "sm" || new Set(regionIds).size > 1;
  return {
    primary: layout.primary.filter((key) => key !== "region" || showRegion),
    more: layout.more,
  };
}

export function optionsFromVisiblePipelines(key, scopedOpportunities, maps = {}) {
  const spec = optionFields[key];
  if (!spec) return [];
  const [field, mapKey] = spec;
  const values = [...new Set((scopedOpportunities || []).map((op) => op[field])
    .filter((value) => value !== "" && value !== null && value !== undefined).map(String))];
  return values.map((value) => ({
    value,
    label: String((mapKey && maps[mapKey]?.[value]?.name) || value),
  })).sort((a, b) => a.label.localeCompare(b.label));
}

export function roleOwnershipMatches(op, userId, view) {
  if (!view || view === "all") return true;
  if (!userId) return false;
  if (view === "mine") return op.owner_id === userId; // Commercial owner, even after handoff
  if (view === "sent") return op.owner_id === userId && op.current_handler_id !== userId;
  if (view === "received") return op.current_handler_id === userId && op.owner_id !== userId;
  return false;
}

export function isPendingSmReview(op) {
  return !op.scenario_id || !op.ccp_check_result || op.ccp_check_result === "pending";
}

export function isFilterActive(key, value) {
  // "All statuses" differs from the default Open view and is resettable.
  if (key === "status") return value !== "" && value != null && value !== "open";
  return value !== "" && value != null && value !== "all";
}
