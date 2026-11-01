// Latest user approval: historical Stage 3 (opened service) imports as Won.
// Preserve original
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
  const id = String(item.source_record_id || "").trim();
  const raw = String(item.source_stage_raw || "").trim();
  if (String(item.stage_id || "").trim() !== "STG003" ||
      String(item.status || "").toLowerCase() !== "won") return false;
  // The latest approved mapping applies to EVERY genuine historical Stage 3
  // service-opening row, not just the initial fixed sample whitelist. A stable
  // source-file hash + original row ID is mandatory for this wider exception.
  if (APPROVED_HISTORICAL_STAGE3_SOURCE_IDS.has(id)) return true;
  return String(item.source_system || "").trim() === "Legacy Spreadsheet" &&
    /^DOC-[a-f0-9]{32}-R[1-9]\d*$/i.test(id) &&
    (!raw || /^Stage\s*3(?:\b|\.|\s)/i.test(raw));
}
