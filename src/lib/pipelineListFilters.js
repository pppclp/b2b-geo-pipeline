import { isInternalSlaOverdue } from "./dashboardMetrics.js";
import { overdueReasons } from "./overdueSummary.js";
import { monthOf, currentMonthKey } from "./pipeline.js";
import { matchesPipelineSearch } from "./pipelineFilterUi.js";
import { isWithMePipeline } from "./dashboardQueue.js";
import { isPipelineCoreIncomplete } from "./pipelineDataCompleteness.js";

// Filtering is presentation-only and always runs on backend-authorized records.
// A single predicate keeps Quick View counts in sync with the list.
export function matchesPipelineFilters(o, f, context, { ignoreStage = false } = {}) {
  const { master, maps, config } = context;
  if (!matchesPipelineSearch(o, f.search)) return false;
  if (f.created_month && o.created_month !== f.created_month) return false;
  if (f.close_month && o.expected_close_month !== f.close_month) return false;
  // "Due This Month" is a work view, not a mutation of the user's Close Month filter.
  // If a month is explicitly selected, mirror the Dashboard's selected-month queue.
  if (f.due_this_month === "1" &&
    o.expected_close_month !== (f.close_month || context.nowMonth || currentMonthKey())) return false;
  if (f.region && o.region_id !== f.region) return false;
  if (f.owner && o.owner_id !== f.owner) return false;
  if (f.handler && o.current_handler_id !== f.handler) return false;
  if (f.with_me === "1" && !isWithMePipeline(o, context.viewerId, {
    role: context.viewerRole, teams: master?.WorkingWithOption,
  })) return false;
  if (f.status && f.status !== "all" && o.status !== f.status) return false;
  if (f.incomplete === "1" && !isPipelineCoreIncomplete(o)) return false;
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
  if (f.stuck === "1" && !overdueReasons(o, maps?.stage, config?.stage_watch_days, context.taskEntries).any) return false;
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
  const base = { ...filters, status: "open", handler: "", with_me: "", stuck: "", due_this_month: "", stage: "" };
  const pool = (scopedRecords || []).filter(o => matchesPipelineFilters(o, base, context));
  return {
    all: pool.length,
    "assigned-to-me": pool.filter(o => isWithMePipeline(o, profileId, {
      role: context.viewerRole, teams: context.master?.WorkingWithOption,
    })).length,
    "stage-overdue": pool.filter(o => overdueReasons(o, context.maps?.stage, context.config?.stage_watch_days, context.taskEntries).any).length,
    "due-this-month": pool.filter(o => o.expected_close_month === (filters.close_month || context.nowMonth || currentMonthKey())).length,
  };
}

export function activePipelineView(filters, profileId, role = "") {
  if (filters.status !== "open") return "";
  if (filters.with_me) return filters.with_me === "1" && role === "management" &&
    !filters.handler && !filters.stuck && !filters.due_this_month
    ? "assigned-to-me" : "";
  if (filters.due_this_month === "1" && !filters.stuck && !filters.handler) return "due-this-month";
  if (filters.stuck === "1" && !filters.due_this_month) return "stage-overdue";
  if (!filters.stuck && !filters.due_this_month && profileId && filters.handler === profileId) return "assigned-to-me";
  if (!filters.handler && !filters.stuck && !filters.due_this_month) return "all";
  return "";
}

// Switch work modes without erasing customer search, selected Region,
// Product Category, Close Month, Stage, or independent advanced filters.
export function switchPipelineView(filters, view, profileId, role = "") {
  const next = { ...filters, status: "open", handler: "", with_me: "", stuck: "", due_this_month: "" };
  if (view === "assigned-to-me" && profileId) {
    if (role === "management") next.with_me = "1";
    else next.handler = profileId;
  }
  if (view === "stage-overdue") next.stuck = "1";
  if (view === "due-this-month") next.due_this_month = "1";
  return next;
}
