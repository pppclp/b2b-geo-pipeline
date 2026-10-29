// Stage master is the only source of truth for active Open workflow stages.
// Never infer Won from a numeric stage order, name, or retired stage ID.
// Historical stages remain stored on Pipelines even after deactivation.
export function activeOpenStages(stages) {
  return (stages || []).filter((stage) => stage.active).slice().sort((a, b) =>
    (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.id || "").localeCompare(String(b.id || ""))
  );
}

export function isActiveOpenStage(stageId, activeStages) {
  return !!stageId && (activeStages || []).some((stage) => stage.id === stageId);
}

// For the Board only. Never hide Open Pipelines whose legacy stage is inactive.
// This is a review queue, NOT an additional sales stage or a Won status.
export function legacyOpenStageRecords(records, activeStages) {
  return (records || []).filter((record) => record.status === "open" &&
    !isActiveOpenStage(record.stage_id, activeStages));
}
