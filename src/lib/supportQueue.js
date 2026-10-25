// Presentation-only helpers; backend applies the actual user/Region access scope.
export function filterSupportRequests(requests = [], filter = "active", viewerId = "") {
  return requests.filter((request) => {
    const active = request.status !== "Resolved";
    if (filter === "unassigned") return active && !request.assigned_to_user_id;
    if (filter === "mine") return active && !!viewerId &&
      String(request.assigned_to_user_id) === String(viewerId);
    if (filter === "active") return active;
    if (filter === "resolved") return !active;
    return filter === "all";
  });
}

export function supportQueueCounts(requests = [], viewerId = "") {
  return Object.fromEntries(["unassigned","mine","active","resolved","all"].map(filter =>
    [filter,filterSupportRequests(requests,filter,viewerId).length]));
}
