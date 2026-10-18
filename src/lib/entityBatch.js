// Unwrap the batch response without disguising critical API failures as an
// empty Pipeline. Permission failures on optional masters may be expected.
const REQUIRED = new Set(["Opportunity", "TeamMember", "Stage"]);

export function unpackEntityBatch(entities, replies) {
  if (!Array.isArray(replies) || replies.length !== entities.length) {
    throw new Error("Data synchronization failed: incomplete backend batch response");
  }
  return entities.map((entity, index) => {
    const reply = replies[index];
    if (reply?.status === 200 && Array.isArray(reply.body)) return reply.body;
    const status = reply?.status ?? "invalid";
    if (REQUIRED.has(entity)) {
      const hint = status === 401 ? "Session expired; please sign in again"
        : status === 403 ? "Access to this data was denied"
        : "Check the Apps Script deployment and Sheet bindings";
      throw new Error(`Cannot load ${entity} (${status}). ${hint}`);
    }
    // Keep optional/read-restricted master sections non-blocking.
    if (status !== 403) console.warn(`Optional ${entity} data unavailable (${status})`);
    return [];
  });
}
