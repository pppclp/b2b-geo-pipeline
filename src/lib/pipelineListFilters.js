import { isStageSlaOverdue, isInternalSlaOverdue } from "@/lib/dashboardMetrics";
import { monthOf } from "@/lib/pipeline";
import { matchesPipelineSearch } from "@/lib/pipelineFilterUi";

// Filtering is presentation-only and always runs on backend-authorized records.
// A single predicate keeps Quick View counts in sync with the list.
export function matchesPipelineFilters(o, f, { master, maps, config }, { ignoreStage = false } = {}) {
  if (!matchesPipelineSearch(o, f.search)) return false;
  if (f.created_month && o.created_month !== f.created_month) return false;
  if (f.close_month && o.expected_close_month !== f.close_month) return false;
  if (f.region && o.region_id !== f.region) return false;
  if (f.owner && o.owner_id !== f.owner) return false;
  if (f.handler && o.current_handler_id !== f.handler) return false;
  if (f.status && f.status !== "all" && o.status !== f.status) return false;
  if (f.sm_info === "missing" &&
    (o.status !== "open" || (o.scenario_id && o.ccp_check_result && o.ccp_check_result !== "pending")))
    return false;
  if (f.product_category && o.product_category_id !== f.product_category) return false;
  if (f.sales_channel && o.sales_channel !== f.sales_channel) return false;
  if (f.ccp_check_result && o.ccp_check_result !== f.ccp_check_result) return false;
  if (f.scenario && o.scenario_id !== f.scenario) return false;
  if (f.working_with) {
    const teamId = (master?.WorkingWithOption || []).find(t => t.name === f.working_with)?.id;
    const teamIds = String(o.working_with_team_ids || "").split(",").map(id => id.trim()).filter(Boolean);
    if (o.working_with !== f.working_with && (!teamId || !teamIds.includes(teamId))) return false;
  }
  if (f.support === "1" && !o.support_needed) return false;
  if (f.support === "0" && o.support_needed) return false;
  if (f.stuck === "1" && !isStageSlaOverdue(o, maps?.stage)) return false;
  if (f.internal_overdue === "1" && !isInternalSlaOverdue(o, config?.internal_task_sla_days)) return false;
  if (f.won_month && monthOf(o.won_at) !== f.won_month) return false;
  if (f.lost_month && monthOf(o.lost_at) !== f.lost_month) return false;
  if (f.lost_reason && o.lost_reason_id !== f.lost_reason) return false;
  if (!ignoreStage && f.stage && o.stage_id !== f.stage) return false;
  return true;
}

// Work view counts exclude the view selector itself and Stage, but respect
// Region, Close Month, Product Category and other independent filters.
export function quickViewCounts(scopedRecords, filters, profileId, context) {
  const base = { ...filters, status: "open", handler: "", support: "", stage: "" };
  const pool = (scopedRecords || []).filter(o => matchesPipelineFilters(o, base, context));
  return {
    all: pool.length,
    "assigned-to-me": pool.filter(o => profileId && o.current_handler_id === profileId).length,
    "support-needed": pool.filter(o => o.support_needed).length,
  };
}

export function activePipelineView(filters, profileId) {
  if (filters.status !== "open") return "";
  if (filters.support === "1" && !filters.handler) return "support-needed";
  if (!filters.support && profileId && filters.handler === profileId) return "assigned-to-me";
  if (!filters.support && !filters.handler) return "all";
  return "";
}

// Switch work modes without erasing customer search, selected Region,
// Product Category, Close Month, Stage, or independent advanced filters.
export function switchPipelineView(filters, view, profileId) {
  const next = { ...filters, status: "open", support: "", handler: "" };
  if (view === "assigned-to-me" && profileId) next.handler = profileId;
  if (view === "support-needed") next.support = "1";
  return next;
}
