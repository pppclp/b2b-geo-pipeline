// Client-side batching for the existing 200-row transactional Apps Script API.
// A stable document fingerprint + chunk ordinal makes partial failures retriable.
// Do not use the random per-upload UI session id for backend idempotency.
export const MAX_IMPORT_BATCH_ROWS = 200;
export function makeHistoricalImportBatches(items, documentId) {
  if (!Array.isArray(items) || !items.length || !/^[a-f0-9]{32}$/.test(String(documentId)))
    throw new Error("Validated import rows and stable source document ID are required");
  const batches = [];
  for (let start = 0; start < items.length; start += MAX_IMPORT_BATCH_ROWS) {
    batches.push({
      batchId: "HIST-" + documentId + "-" + String(batches.length + 1).padStart(3, "0"),
      startRow: start + 1,
      endRow: Math.min(start + MAX_IMPORT_BATCH_ROWS, items.length),
      items: items.slice(start, start + MAX_IMPORT_BATCH_ROWS)
    });
  }
  return batches;
}
