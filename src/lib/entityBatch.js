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
      const serverMessage = typeof reply?.body?.message === "string"
        ? reply.body.message.replace(/[\r\n\t]+/g, " ").trim().slice(0, 240)
        : "";
      // A response like Opportunity (503) alone hides the actual backend
      // explanation (wrong workbook, missing sheet or UAT mismatch).
      // Preserve the server error so UAT can diagnose failures without
      // mistaking them for zero Pipelines. Do not log request tokens.
      throw new Error(`Cannot load ${entity} (${status}). ${serverMessage ? serverMessage + ". " : ""}${hint}`);
    }
    // A genuine permission denial may hide an optional master. Any other
    // failure is NOT an empty dataset: block misleading dashboard figures.
    if (status === 403) return [];
    const reason = typeof reply?.body?.code === "string" ? reply.body.code : "DATA_SOURCE_ERROR";
    throw new Error(`Cannot load ${entity} (${status}, ${reason}). Check Apps Script deployment and sheet schema.`);
  });
}
