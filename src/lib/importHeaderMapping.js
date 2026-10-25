// Conservative, deterministic import header matching. Never auto-map ambiguous columns.
// Thai combining marks must survive normalization; empty/unknown headers never match.
export const IMPORT_HEADER_ALIASES = {
  customer_name: ["ชื่อลูกค้า", "ชื่อบริษัท", "ชื่อนิติบุคคล", "ลูกค้า"],
  business_id: ["เลขทะเบียนนิติบุคคล", "เลขประจำตัวผู้เสียภาษี", "เลขผู้เสียภาษี", "เลขทะเบียนบริษัท", "เลขประจำตัวผู้เสียภาษี13หลัก"],
  customer_type: ["ประเภทลูกค้า"],
  sales_channel: ["ช่องทางขาย", "ช่องทางการขาย"],
  partner_name: ["ชื่อพาร์ทเนอร์", "ชื่อคู่ค้า"],
  reference_net_rc: ["Net RC", "Net RC (Existing)", "Reference Net RC", "ยอด Net RC อ้างอิง"],
  contact_name: ["ชื่อผู้ติดต่อ", "ผู้ติดต่อ"],
  contact_phone: ["เบอร์ผู้ติดต่อ", "เบอร์โทรผู้ติดต่อ", "หมายเลขโทรศัพท์", "โทรศัพท์ผู้ติดต่อ"],
  remark: ["หมายเหตุ"],
  region: ["ภาค", "ภูมิภาค", "รีเจียน", "เขตภูมิภาค"],
  territory: ["พื้นที่", "เขตพื้นที่", "เทร์ริทอรี"],
  owner: ["เจ้าของดีล", "เจ้าของโอกาสขาย", "ผู้รับผิดชอบหลัก", "เออีเจ้าของดีล"],
  handler: ["ผู้ดูแลปัจจุบัน", "ผู้รับผิดชอบปัจจุบัน", "ผู้ดำเนินการปัจจุบัน"],
  product_category: ["หมวดสินค้า", "ประเภทสินค้า", "หมวดผลิตภัณฑ์"],
  product_details: ["รายละเอียดสินค้า", "รายละเอียดผลิตภัณฑ์"],
  quantity: ["จำนวน", "จำนวนซิม", "จำนวนเลขหมาย"],
  price_per_sub: ["ราคาต่อซิม", "ราคาต่อเลขหมาย", "ราคาต่อหน่วย"],
  oc: ["ค่าแรกเข้า", "ค่าใช้จ่ายครั้งเดียว"],
  contract_period: ["ระยะสัญญา", "ระยะเวลาสัญญา", "ระยะสัญญาเดือน"],
  expected_close_month: ["เดือนคาดว่าจะปิดการขาย", "เดือนที่คาดว่าจะปิดดีล", "เดือนปิดดีล"],
  scenario: ["สถานการณ์ขาย", "ประเภทสถานการณ์", "สถานการณ์"],
  ccp_check_result: ["ผลตรวจccp", "ผลตรวจccp+"],
  stage: ["ขั้นตอน", "ขั้นตอนการขาย", "สเตจ"],
  status: ["สถานะ", "สถานะดีล"],
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
