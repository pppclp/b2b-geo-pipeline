import { monthOf } from "./pipeline.js";
import { isStageSlaOverdue, isInternalSlaOverdue } from "./dashboardMetrics.js";

// Presentation only. The backend has already authorized scopedOpportunities.
// Never apply a role filter to expand the records returned by the server.
const PRIMARY_BY_ROLE = {
  ae: ["stage"],
  sm: ["stage", "owner", "region"],
  management: ["stage", "region", "owner", "product_category", "sales_channel"],
  admin: ["stage", "region", "owner", "product_category", "sales_channel"],
};
const MORE_BY_ROLE = {
  ae: ["stuck", "internal_overdue", "support", "created_month", "won_month", "lost_month", "lost_reason", "product_category", "sales_channel"],
  sm: ["stuck", "internal_overdue", "support", "needs_review", "product_category", "sales_channel", "handler", "working_with", "scenario", "ccp_check_result", "created_month", "won_month", "lost_month", "lost_reason"],
  management: ["stuck", "internal_overdue", "support", "handler", "working_with", "scenario", "ccp_check_result", "created_month", "won_month", "lost_month", "lost_reason"],
  admin: ["stuck", "internal_overdue", "support", "needs_review", "handler", "working_with", "scenario", "ccp_check_result", "created_month", "won_month", "lost_month", "lost_reason"],
};

export function filterLayout(role) {
  return {
    primary: PRIMARY_BY_ROLE[role] || PRIMARY_BY_ROLE.ae,
    more: MORE_BY_ROLE[role] || MORE_BY_ROLE.ae,
  };
}

export function ownershipGroup(op, userId) {
  if (!userId) return "";
  if (op.owner_id === userId) return op.current_handler_id === userId ? "mine" : "sent";
  return op.current_handler_id === userId ? "received" : "";
}

export function isPendingSmReview(op) {
  return !op.scenario_id || !op.ccp_check_result || op.ccp_check_result === "pending";
}

export function applyPipelineFilters(scopedOpportunities, filters, { profile, maps, config } = {}) {
  const f = filters || {};
  const query = String(f.search || "").trim().toLocaleLowerCase();
  return (scopedOpportunities || []).filter((op) => {
    if (query && ![op.customer_name, op.business_id, op.contact_name]
      .some((text) => String(text || "").toLocaleLowerCase().includes(query))) return false;
    if (profile?.app_role === "ae" && f.ownership_view && f.ownership_view !== "all") {
      // Commercial ownership persists when work is handed off to SM.
      if (f.ownership_view === "mine") {
        if (op.owner_id !== profile.id) return false;
      } else if (ownershipGroup(op, profile.id) !== f.ownership_view) return false;
    }
    if (profile?.app_role === "sm" && f.with_me === "1" && op.current_handler_id !== profile.id) return false;
    if (f.created_month && op.created_month !== f.created_month) return false;
    if (f.close_month && op.expected_close_month !== f.close_month) return false;
    if (f.region && op.region_id !== f.region) return false;
    if (f.owner && op.owner_id !== f.owner) return false;
    if (f.handler && op.current_handler_id !== f.handler) return false;
    if (f.stage && op.stage_id !== f.stage) return false;
    if (f.status && f.status !== "all" && op.status !== f.status) return false;
    if (f.product_category && op.product_category_id !== f.product_category) return false;
    if (f.sales_channel && op.sales_channel !== f.sales_channel) return false;
    if (f.ccp_check_result && op.ccp_check_result !== f.ccp_check_result) return false;
    if (f.scenario && op.scenario_id !== f.scenario) return false;
    if (f.working_with && op.working_with !== f.working_with) return false;
    if (f.support === "1" && !op.support_needed) return false;
    if (f.support === "0" && !!op.support_needed) return false;
    if (f.stuck === "1" && !isStageSlaOverdue(op, maps?.stage || {})) return false;
    if (f.internal_overdue === "1" && !isInternalSlaOverdue(op, config?.internal_task_sla_days)) return false;
    if (f.needs_review === "1" && !isPendingSmReview(op)) return false;
    if (f.won_month && monthOf(op.won_at) !== f.won_month) return false;
    if (f.lost_month && monthOf(op.lost_at) !== f.lost_month) return false;
    if (f.lost_reason && op.lost_reason_id !== f.lost_reason) return false;
    return true;
  });
}

const simpleLabel = (value, map) => String(map?.[value]?.name || value);
const optionsFrom = (values, labelOf) => [...new Set(values.filter((v) => v != null && v !== "").map(String))]
  .map((value) => ({ value, label: labelOf ? labelOf(value) : value }))
  .sort((a, b) => a.label.localeCompare(b.label));

export function availableFilterOptions(scopedOpportunities, maps = {}) {
  const ops = scopedOpportunities || [];
  const collect = (field, labels) => optionsFrom(ops.map((op) => op[field]), labels);
  const named = (field, map) => collect(field, (value) => simpleLabel(value, map));
  return {
    region: named("region_id", maps.region),
    owner: named("owner_id", maps.member),
    handler: named("current_handler_id", maps.member),
    stage: named("stage_id", maps.stage),
    product_category: named("product_category_id", maps.category),
    sales_channel: collect("sales_channel"),
    scenario: named("scenario_id", maps.scenario),
    ccp_check_result: optionsFrom(ops.map((o) => o.ccp_check_result), (key) => ({
      not_in_base: "Not in Base (New Customer)",
      enterprise_base: "Enterprise Existing Base",
      pending: "Pending Review",
    }[key] || key)),
    working_with: collect("working_with"),
    created_month: collect("created_month"),
    won_month: optionsFrom(ops.map((o) => monthOf(o.won_at))),
    lost_month: optionsFrom(ops.map((o) => monthOf(o.lost_at))),
    lost_reason: named("lost_reason_id", maps.lostReason),
  };
}

// Optional dropdowns with only one possible value add no information.
// Always preserve a filter currently selected via a deep link.
export function shouldShowDropdown(options, selectedValue = "") {
  return (options?.length || 0) >= 2 || Boolean(selectedValue && selectedValue !== "all");
}

export function statusCounts(scopedOpportunities) {
  const counts = { all: 0, open: 0, won: 0, lost: 0, archived: 0 };
  for (const op of scopedOpportunities || []) {
    counts.all++;
    if (op.status in counts) counts[op.status]++;
  }
  return counts;
}

// Primary business navigation should never disappear while data is loading,
// when a role owns one Stage, or when a backend error returns no rows.
// Region is the only primary dropdown that SMs do not need for one Region.
export function visiblePrimaryFilters(role, options, filters = {}) {
  return filterLayout(role).primary.filter((key) =>
    !(key === "region" && role === "sm" && !shouldShowDropdown(options?.region, filters.region))
  );
}
