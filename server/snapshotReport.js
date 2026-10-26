// Presentation-only monthly report projection. The canonical Snapshots sheet
// retains its historical schema for compatibility and auditability.
export const MONTHLY_PIPELINE_REPORT_COLUMNS = Object.freeze([
  "snapshot_period", "opportunity_id", "customer_name", "region_id",
  "owner_sale_name", "current_handler_user_id", "product_category_id",
  "pipeline_value", "stage_id", "status", "stage_aging_days",
  "expected_close_month", "support_needed",
]);

export function monthlyPipelineReportRows(snapshots) {
  if (!Array.isArray(snapshots)) throw new TypeError("Snapshots must be an array");
  return snapshots.map((row) => {
    const out = {};
    for (const field of MONTHLY_PIPELINE_REPORT_COLUMNS) {
      out[field] = field === "stage_aging_days" ? "" : (row[field] ?? "");
    }
    // Stage aging is not derivable reliably from a date-only legacy import.
    // Do not fabricate it from the current clock or a later snapshot.
    if (row.stage_last_updated_at && row.captured_at) {
      const start = Date.parse(row.stage_last_updated_at);
      const end = Date.parse(row.captured_at);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        out.stage_aging_days = Math.floor((end - start) / 86400000);
      }
    }
    return out;
  });
}
