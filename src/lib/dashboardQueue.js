/**
 * The "With Me" queue is a personal action list, not a region-wide approval
 * or Needs Support queue. An approval belongs here only after a Manager is
 * explicitly assigned as Current Handler via the existing handoff workflow.
 */
export function withMePipelines(pipelines = [], userId) {
  if (!userId) return [];
  return pipelines.filter((item) =>
    item.status === "open" && item.current_handler_id === userId
  );
}
