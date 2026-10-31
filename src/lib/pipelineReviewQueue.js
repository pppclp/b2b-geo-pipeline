import { isPipelineCoreIncomplete, missingPipelineCoreFields } from "./pipelineDataCompleteness.js";
import { isActiveOpenStage } from "./openStagePolicy.js";
import { matchesPipelineSearch } from "./pipelineFilterUi.js";

// Read-only review signals. Never infer Won/Lost from a Stage or write data.
// Stage 3 is intentionally in the transition queue even while still active
// in Config; deactivating it is a separate approved master-data action.
export const STAGE_REVIEW_TRANSITION_ID = "STG003";

export function isMissingSmInfo(op) {
  return op?.status === "open" &&
    (!op.scenario_id || !op.ccp_check_result || op.ccp_check_result === "pending");
}

export function requiresStageReview(op, activeStages = []) {
  return op?.status === "open" &&
    (op.stage_id === STAGE_REVIEW_TRANSITION_ID ||
      !isActiveOpenStage(op.stage_id, activeStages));
}

export function reviewSignals(op, activeStages, role = "") {
  if (!op || op.status !== "open") return { core: [], sm: false, stage: false, any: false };
  const core = missingPipelineCoreFields(op);
  const sm = role === "sm" && isMissingSmInfo(op);
  const stage = requiresStageReview(op, activeStages);
  return { core, sm, stage, any: core.length > 0 || sm || stage };
}

// Filter only caller-authorized rows; never search the unscoped database.
// The same row appears only once in All, even when several signals are true.
export function reviewQueueRows(scopedRows = [], { activeStages = [], role = "", tab = "all", dataType = "all", search = "" } = {}) {
  return scopedRows.filter(op => {
    const flags = reviewSignals(op, activeStages, role);
    if (!flags.any || !matchesPipelineSearch(op, search)) return false;
    if (tab === "stage") return flags.stage;
    if (tab === "data") {
      if (dataType === "core") return flags.core.length > 0;
      if (dataType === "sm") return flags.sm;
      return flags.core.length > 0 || flags.sm;
    }
    return tab === "all";
  });
}

export function reviewQueueCounts(scopedRows = [], activeStages = [], role = "") {
  const counts = { all: 0, data: 0, stage: 0, core: 0, sm: 0 };
  for (const op of scopedRows) {
    const flags = reviewSignals(op, activeStages, role);
    if (!flags.any) continue;
    counts.all++;
    if (flags.core.length || flags.sm) counts.data++;
    if (flags.core.length) counts.core++;
    if (flags.sm) counts.sm++;
    if (flags.stage) counts.stage++;
  }
  return counts;
}
