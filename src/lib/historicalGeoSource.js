// Normalize only the documented 19-column all-region historical export.
// Every record keeps its original source row number and receives an explicit
// layout error when the trailing columns cannot be proved from their values.
// Never infer owner, sales channel, region, stage status, or financial amounts.
const historicalHeader = (headers) => headers?.length === 19 &&
  String(headers[0] || "").trim().toLowerCase() === "create month" &&
  String(headers[1] || "").trim().toLowerCase() === "business id" &&
  String(headers[15] || "").trim().toLowerCase() === "monthly sale plan" &&
  String(headers[16] || "").trim().toLowerCase() === "stage (current)";

function isMonth(value) {
  const text = String(value || "").trim();
  return /^(?:20\d{2}-(?:0[1-9]|1[0-2])|(?:[A-Za-z]{3,9}|[ก-๙.]+)[-_\/](?:\d{2}|\d{4}))$/.test(text);
}
function isStage(value) {
  return /^(?:Stage\s*[1-9]\d*(?:[.\s:\-]|$)|Cancel(?:\s|$)|Approach(?:\s|$))/i.test(String(value || "").trim());
}
function isContract(value) {
  const text = String(value || "").trim();
  return !text || /^\d{1,3}\s*(?:months?|เดือน)$/i.test(text);
}
export function normalizeHistoricalGeoSource(headers, rows) {
  if (!historicalHeader(headers)) return { headers, rows, layoutErrors: rows.map(() => "") };
  const layoutErrors = [];
  const mappedRows = rows.map((raw, index) => {
    const row = Array.from({ length: 19 }, (_, col) => String(raw[col] ?? ""));
    const tail = row.slice(15);
    if (isMonth(tail[0]) && isStage(tail[1])) {
      layoutErrors.push("");
      return [...row.slice(0, 15), "", tail[0], tail[1],
        [tail[2], tail[3]].filter((s) => s.trim()).join(" | ")];
    }
    if (isContract(tail[0]) && isMonth(tail[1]) && isStage(tail[2])) {
      layoutErrors.push("");
      return [...row.slice(0, 15), tail[0], tail[1], tail[2], tail[3]];
    }
    layoutErrors.push("Historical column layout cannot be verified (source data row " + (index + 2) + "). Review Contract Period, Monthly Sale Plan, Stage and Remark.");
    // This is review-only data: the layout error blocks this record from import.
    // Keep all original trailing values; never rearrange an uncertain row.
    return [...row.slice(0, 15), ...tail];
  });
  return {
    headers: [...headers.slice(0, 15), "Contract Period", "Monthly Sale Plan",
      "Stage (Current)", "Remark"],
    rows: mappedRows, layoutErrors
  };
}
