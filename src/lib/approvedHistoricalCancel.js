// Only the eight user-approved, source-identifiable historical Cancel records
// may be imported as Lost without inventing an Original Closed Date.
// This is not a permission for normal Mark Lost / Create operations.
const APPROVED_UNDATED_CANCEL_ROWS = Object.freeze([32, 80, 146, 218, 221, 232, 233, 240]);
const SOURCE_DOCUMENT = "DOC-79e97612cde3acfee14cfb26a78e0ddd-R";
export const APPROVED_UNDATED_CANCEL_SOURCE_IDS =
  new Set(APPROVED_UNDATED_CANCEL_ROWS.map(row => SOURCE_DOCUMENT + row));

export function approvedUndatedHistoricalCancel(item = {}) {
  return String(item.status || "").toLowerCase() === "lost" &&
    !String(item.source_closed_at || "").trim() &&
    APPROVED_UNDATED_CANCEL_SOURCE_IDS.has(String(item.source_record_id || "").trim());
}

export const APPROVED_RAW_9_DAY_SOURCE_ID = SOURCE_DOCUMENT + "240";
export function approvedRaw9DayMonthlyPlan(item = {}, value = "") {
  return String(item.source_record_id || "").trim() === APPROVED_RAW_9_DAY_SOURCE_ID &&
    String(value || "").trim() === "9 Day";
}
