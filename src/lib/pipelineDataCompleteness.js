// Read-only display checks for core Pipeline fields. This is NOT save validation
// and must never modify historical imports or block unrelated edits.
// Normal Pipeline pricing stays out of core completeness. Import-only missing
// source RC, Net RC and quantity must be visible to SM without fabricating zero.
// Business ID, contacts, OC, partner and SM-only Scenario/CCP+ remain optional.
import { normalizeSalesChannel } from "./salesChannel.js";

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
  // Unknown/retired values like Other are not a fourth channel. They need review.
  const base = CORE_FIELDS.filter(([key]) => key === "sales_channel"
    ? !normalizeSalesChannel(opportunity[key])
    : missing(opportunity[key]))
    .map(([key, label]) => ({ key, label }));
  if (opportunity.import_batch_id || opportunity.import_source_record_id) {
    // Historical Cancel may be Lost without a proven original closed date.
    // Keep the missing date visible as Incomplete Data; never forge lost_at.
    const historicalStatus = String(opportunity.status || "").toLowerCase();
    if (historicalStatus === "lost" && missing(opportunity.lost_at))
      base.push({ key: "lost_at", label: "Original Closed Date" });
    if (historicalStatus === "won" && missing(opportunity.won_at))
      base.push({ key: "won_at", label: "Original Closed Date" });
    const sourceNumber = (raw) => {
      const value = String(raw ?? "").trim().replace(/,/g, "");
      return value !== "" && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
    };
    if (!Number.isSafeInteger(Number(opportunity.quantity)) ||
        opportunity.quantity == null || opportunity.quantity === "" ||
        Number(opportunity.quantity) <= 0)
      base.push({ key: "quantity", label: "จำนวน Subs" });
    if (!sourceNumber(opportunity.import_source_rc))
      base.push({ key: "import_source_rc", label: "RC ต้นฉบับ" });
    if (!sourceNumber(opportunity.import_source_net_rc))
      base.push({ key: "import_source_net_rc", label: "Net RC ต้นฉบับ" });
  }
  return base;
}

export function isPipelineCoreIncomplete(opportunity) {
  return missingPipelineCoreFields(opportunity).length > 0;
}
