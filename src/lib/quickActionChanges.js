/**
 * Build one atomic Pipeline update while keeping the Stage and Handler clocks
 * independent. Pure function shared by Quick View and Full Detail.
 */
export function buildQuickActionChanges(op, input, { stages, maps, now }) {
  if (!op) throw new Error("Pipeline not found");
  if (op.status !== "open") throw new Error("Only open Pipelines can be changed");
  const changes = {};
  const events = [];
  const { stageId, handlerId, workingWith } = input;
  if (stageId && stageId !== op.stage_id) {
    if (!stages.some((stage) => stage.id === stageId)) throw new Error("Invalid Stage");
    changes.stage_id = stageId;
    changes.stage_entered_at = now;
    events.push({
      event_type: "stage_change", field: "stage",
      previous_value: maps.stage[op.stage_id]?.name || op.stage_id,
      new_value: maps.stage[stageId]?.name || stageId,
    });
  }
  if (handlerId && handlerId !== op.current_handler_id) {
    changes.current_handler_id = handlerId;
    changes.handler_since = now;
    events.push({
      event_type: "handler_change", field: "current_handler",
      previous_value: maps.member[op.current_handler_id]?.name || op.current_handler_id || "",
      new_value: maps.member[handlerId]?.name || handlerId,
    });
  }
  const team = workingWith || "";
  if (team !== (op.working_with || "")) {
    changes.working_with = team;
    changes.working_with_since = team ? now : "";
    events.push({
      event_type: "working_with_change", field: "working_with",
      previous_value: op.working_with || "",
      new_value: team,
    });
  }
  return { changes, events };
}
