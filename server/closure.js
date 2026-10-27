/**
 * Validate Pipeline close-out. Status is independent from sales Stage.
 * The server supplies the actual authenticated actor and timestamp;
 * caller-supplied closure metadata must never be trusted.
 */
export function normalizeClosureUpdate(data, current, lostReasons, actorId, timestamp) {
  const output = { ...data };
  const status = String(data.status ?? current.status ?? "").trim().toLowerCase();
  const previous = String(current.status || "").trim().toLowerCase();
  const isClosing = "status" in data && status !== previous && (status === "won" || status === "lost");

  if ("status" in data && !["open", "won", "lost", "archived"].includes(status)) {
    throw new Error("Invalid Pipeline status");
  }
  if (isClosing && previous !== "open") {
    throw new Error("Only an open Pipeline can be marked Won or Lost");
  }
  if (status === "lost" && (isClosing || "lost_reason_id" in data)) {
    const reasonId = String(output.lost_reason_id ?? current.lost_reason_id ?? "").trim();
    const valid = lostReasons.some((reason) =>
      String(reason.reason_id) === reasonId &&
      // Older and current contracted Lost_Reasons tabs may omit `active` entirely.\n      // Match the shared master-data policy: blank means active, explicit No means inactive.\n      (reason.active == null || String(reason.active).trim() === "" ||\n        ["YES", "Y", "TRUE", "1"].includes(String(reason.active).trim().toUpperCase()))
    );
    if (!valid) throw new Error("Select an active Lost Reason before marking Pipeline Lost");
  }
  if (isClosing) {
    if (status === "won") {
      output.won_at = timestamp;
      output.won_by = actorId;
    } else {
      output.lost_at = timestamp;
      output.lost_by = actorId;
      output.lost_note = String(output.lost_note || "").trim();
    }
  }
  return output;
}
