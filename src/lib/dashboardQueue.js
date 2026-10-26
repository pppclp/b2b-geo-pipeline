/**
 * "With Me" is a presentation-only queue over records already authorized
 * by the backend. Individual Current Handler assignments apply to every
 * role; Working With: Management additionally applies to Management viewers.
 * Neither case grants data access or changes the responsible handler.
 */
export function managementTeamId(teams = []) {
  const matches = teams.filter((team) =>
    team?.active && String(team.name || "").trim().toLowerCase() === "management"
  );
  return matches.length === 1 ? String(matches[0].id || "") : "";
}

export function isWithMePipeline(item, userId, { role = "", teams = [] } = {}) {
  if (!userId || item?.status !== "open") return false;
  if (item.current_handler_id === userId) return true;
  if (role !== "management") return false;

  const teamId = managementTeamId(teams);
  if (!teamId) return false; // Fail closed when the active team is unknown.
  const selected = String(item.working_with_team_ids || "")
    .split(",").map((id) => id.trim()).filter(Boolean);
  if (selected.length) return selected.includes(teamId);
  // Historical single-team records predate the multi-select field.
  return String(item.working_with_id || "") === teamId ||
    String(item.working_with || "").trim().toLowerCase() === "management";
}

export function withMePipelines(pipelines = [], userId, context = {}) {
  return pipelines.filter((item) => isWithMePipeline(item, userId, context));
}
