// Conservative, deterministic import header matching. Never auto-map ambiguous columns.
// Thai combining marks must survive normalization; empty/unknown headers never match.
export const IMPORT_HEADER_ALIASES = {
  created_month: ["Create Month", "Created Month", "วันที่สร้าง", "เดือนที่สร้าง", "เดือนสร้าง"],
  source_created_at: ["Original Created Date", "Source Created Date", "Created Date", "Original Created At"],
  source_stage_entered_at: ["Original Stage Entered Date", "Stage Entered Date", "Stage Updated Date"],
  source_closed_at: ["Original Closed Date", "Actual Close Date", "Won Date", "Lost Date", "Closed Date"],
  source_record_id: ["Legacy Opportunity ID", "Source Opportunity ID", "Original Opportunity ID", "CRM Opportunity ID"],
  source_system: ["Source System", "Source System Name", "ระบบต้นทาง"],
  customer_name: ["ชื่อลูกค้า", "ชื่อบริษัท", "ชื่อนิติบุคคล", "ลูกค้า"],
  business_id: ["เลขทะเบียนนิติบุคคล", "เลขประจำตัวผู้เสียภาษี", "เลขผู้เสียภาษี", "เลขทะเบียนบริษัท", "เลขประจำตัวผู้เสียภาษี13หลัก"],
  customer_type: ["ประเภทลูกค้า", "Customer Segment", "กลุ่มลูกค้า"],
  sales_channel: ["ช่องทางขาย", "ช่องทางการขาย"],
  partner_name: ["ชื่อพาร์ทเนอร์", "ชื่อคู่ค้า"],
  reference_net_rc: ["Net RC", "Net RC (Existing)", "Reference Net RC", "ยอด Net RC อ้างอิง"],
  contact_name: ["ชื่อผู้ติดต่อ", "ผู้ติดต่อ"],
  contact_phone: ["เบอร์ผู้ติดต่อ", "เบอร์โทรผู้ติดต่อ", "หมายเลขโทรศัพท์", "โทรศัพท์ผู้ติดต่อ"],
  remark: ["หมายเหตุ"],
  region: ["ภาค", "ภูมิภาค", "รีเจียน", "เขตภูมิภาค", "Region Name", "Region ID", "Region Code"],
  territory: ["พื้นที่", "เขตพื้นที่", "เทร์ริทอรี", "Territory Name", "Territory ID"],
  owner: ["เจ้าของดีล", "เจ้าของโอกาสขาย", "ผู้รับผิดชอบหลัก", "เออีเจ้าของดีล", "AE Name", "Owner Name", "Owner User ID", "AE User ID"],
  handler: ["ผู้ดูแลปัจจุบัน", "ผู้รับผิดชอบปัจจุบัน", "ผู้ดำเนินการปัจจุบัน", "Handler Name", "Handler User ID"],
  product_category: ["หมวดสินค้า", "ประเภทสินค้า", "หมวดผลิตภัณฑ์", "Category ID", "Category Name", "Product Category ID"],
  product_details: ["รายละเอียดสินค้า", "รายละเอียดผลิตภัณฑ์", "Product Name", "ชื่อสินค้า"],
  source_product_id: ["Legacy Product ID", "Product ID", "รหัสสินค้าเดิม"],
  source_rc: ["RC", "Recurring Charge", "Legacy RC"],
  source_discount_pct: ["Discount %", "Discount Pct", "Discount Percentage", "ส่วนลดเปอร์เซ็นต์"],
  source_monthly_sale_plan: ["Monthly Sale Plan", "Sale Plan", "แผนยอดขายรายเดือน"],
  quantity: ["จำนวน", "จำนวนซิม", "จำนวนเลขหมาย"],
  price_per_sub: ["ราคาต่อซิม", "ราคาต่อเลขหมาย", "ราคาต่อหน่วย"],
  oc: ["ค่าแรกเข้า", "ค่าใช้จ่ายครั้งเดียว"],
  contract_period: ["ระยะสัญญา", "ระยะเวลาสัญญา", "ระยะสัญญาเดือน"],
  expected_close_month: ["เดือนคาดว่าจะปิดการขาย", "เดือนที่คาดว่าจะปิดดีล", "เดือนปิดดีล"],
  scenario: ["สถานการณ์ขาย", "ประเภทสถานการณ์", "สถานการณ์"],
  ccp_check_result: ["ผลตรวจccp", "ผลตรวจccp+"],
  stage: ["ขั้นตอน", "ขั้นตอนการขาย", "สเตจ", "Stage Name", "Stage ID"],
  status: ["สถานะ", "สถานะดีล", "Pipeline Status"],
  lost_reason: ["Lost Reason", "เหตุผลที่แพ้", "เหตุผลที่ไม่สำเร็จ"],
  working_with: ["ทำงานร่วมกับ", "ทีมที่ร่วมงาน"],
  support_needed: ["ต้องการความช่วยเหลือ", "ขอการสนับสนุน"],
  support_type: ["ประเภทความช่วยเหลือ", "ประเภทการสนับสนุน"],
  support_note: ["รายละเอียดความช่วยเหลือ", "หมายเหตุการสนับสนุน"],
};

export function normalizeImportHeader(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

export function mapImportHeaders(headers, fields) {
  const normalized = headers.map(normalizeImportHeader);
  const used = new Set();
  const mapping = {};
  // Exact matching only: do not auto-select a plausible but incorrect column.
  // Unrecognized or duplicate headers remain for manual review.
  for (const field of fields) {
    const accepted = new Set([field.key, field.label, ...(IMPORT_HEADER_ALIASES[field.key] || [])]
      .map(normalizeImportHeader).filter(Boolean));
    const matches = normalized.map((name, index) => ({name,index}))
      .filter(({name,index}) => name && accepted.has(name) && !used.has(index));
    if (matches.length !== 1) continue;
    mapping[field.key] = matches[0].index;
    used.add(matches[0].index);
  }
  return mapping;
}

// A recognized source-created-month column must not be silently dropped when
 // auto-mapping abstains (e.g. duplicate "Create Month"/"Created Month").
 // The user may resolve ambiguity using the existing manual mapping control.
export function needsExplicitCreatedMonthMapping(headers, mapping) {
  if (mapping?.created_month != null) return false;
  const accepted = new Set(["created_month", "Create Month", ...(IMPORT_HEADER_ALIASES.created_month || [])]
    .map(normalizeImportHeader));
  return headers.some(header => accepted.has(normalizeImportHeader(header)));
}
