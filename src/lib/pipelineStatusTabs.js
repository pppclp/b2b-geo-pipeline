import { matchesPipelineFilters } from "./pipelineListFilters.js";

export const PIPELINE_STATUS_TABS = Object.freeze([
  { id: "open", label: "Open" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
]);

// View-only counts: respect independent search/category/region/month filters,
// never leak beyond records already scoped by the server.
export function pipelineStatusCounts(scopedRows = [], filters = {}, context = {}) {
  const independent = {
    ...filters, status: "all", stage: "", with_me: "", handler: "",
    stuck: "", due_this_month: "", internal_overdue: "",
    won_month: "", lost_month: "", lost_reason: "",
  };
  const counts = { open: 0, won: 0, lost: 0 };
  for (const op of scopedRows) {
    if (!Object.hasOwn(counts, op.status)) continue;
    if (matchesPipelineFilters(op, independent, context)) counts[op.status]++;
  }
  return counts;
}

// Selecting a closed status cannot silently retain an Open work view or
// an active Stage filter; independent filters remain untouched.
export function nextPipelineStatusFilters(filters = {}, nextStatus = "open") {
  if (!["open", "won", "lost", "archived", "all"].includes(nextStatus)) return { ...filters };
  return {
    ...filters, status: nextStatus, stage: "", handler: "", with_me: "",
    stuck: "", due_this_month: "", internal_overdue: "",
    won_month: "", lost_month: "", lost_reason: "",
  };
}

export function pipelineStageDisplay(op, activeStages = [], stageMap = {}) {
  if (op?.status === "won") return { label: "Won", tone: "won" };
  if (op?.status === "lost") return { label: "Lost", tone: "lost" };
  if (!op || op.status !== "open") return { label: op?.status || "—", tone: "neutral" };
  if (!(activeStages || []).some(stage => stage.id === op.stage_id)) {
    return { label: "รอยืนยัน Stage", tone: "review" };
  }
  if (op.stage_id === "STG001") return { label: stageMap[op.stage_id]?.name || "Stage 1", tone: "stage1" };
  if (op.stage_id === "STG002") return { label: stageMap[op.stage_id]?.name || "Stage 2", tone: "stage2" };
  return { label: stageMap[op.stage_id]?.name || op.stage_id, tone: "neutral" };
}
