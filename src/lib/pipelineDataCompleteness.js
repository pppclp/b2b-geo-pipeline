// Read-only display checks for core Pipeline fields. This is NOT save validation
// and must never modify historical imports or block unrelated edits.
// Business ID, contacts, price/quantity, OC, contract, partner and SM-only
// Scenario/CCP+ are deliberately excluded (optional or separately reviewed).
const CORE_FIELDS = Object.freeze([
  ["customer_name", "ชื่อลูกค้า"],
  ["customer_type", "ประเภทลูกค้า"],
  ["sales_channel", "ช่องทางการขาย"],
  ["region_id", "Region"],
  ["owner_id", "AE Owner"],
  ["product_category_id", "ประเภทผลิตภัณฑ์"],
  ["stage_id", "Stage"],
  ["expected_close_month", "เดือนที่คาดว่าจะปิดงาน"],
]);

const missing = (value) => value == null || String(value).trim() === "";

export function missingPipelineCoreFields(opportunity) {
  if (!opportunity) return [];
  return CORE_FIELDS.filter(([key]) => missing(opportunity[key]))
    .map(([key, label]) => ({ key, label }));
}

export function isPipelineCoreIncomplete(opportunity) {
  return missingPipelineCoreFields(opportunity).length > 0;
}
