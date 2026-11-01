// User-approved historical Stage 3 / Open import: keep the original
// inactive STG003 value. Never reactivate the master Stage or change
// validation of live Create/Edit or other imported source IDs.
const DOCUMENT_PREFIX = "DOC-79e97612cde3acfee14cfb26a78e0ddd-R";
export const APPROVED_HISTORICAL_STAGE3_SOURCE_IDS = new Set([
  DOCUMENT_PREFIX + "7",
  DOCUMENT_PREFIX + "15",
  DOCUMENT_PREFIX + "16",
  DOCUMENT_PREFIX + "17",
  DOCUMENT_PREFIX + "20",
  DOCUMENT_PREFIX + "24",
  DOCUMENT_PREFIX + "25",
  DOCUMENT_PREFIX + "27",
  DOCUMENT_PREFIX + "77",
  DOCUMENT_PREFIX + "78",
  DOCUMENT_PREFIX + "79",
  DOCUMENT_PREFIX + "81",
  DOCUMENT_PREFIX + "82",
  DOCUMENT_PREFIX + "214",
]);
export function approvedHistoricalStage3(item = {}) {
  return APPROVED_HISTORICAL_STAGE3_SOURCE_IDS.has(String(item.source_record_id || "").trim()) &&
    String(item.stage_id || "").trim() === "STG003" &&
    String(item.status || "open").toLowerCase() === "open";
}
