import { formatMonth, agingDays, STATUS_LABELS } from "./pipeline.js";

// Text identifiers (Business ID, phone, employee names) stay text in Excel,
// avoiding lost leading zeroes and accidental numeric conversion.
export const PIPELINE_EXPORT_HEADERS = [
  "Opportunity ID", "Customer Name", "Business ID", "Customer Type",
  "Sales Channel", "Partner Name", "Contact Name", "Contact Phone", "Remark",
  "Product Category", "Product Details", "Number of Subs", "Price per Sub (THB)", "OC (THB)", "Contract Period (months)",
  "Net RC (THB/month)", "Scenario", "CCP+ Check",
  "Region", "Territory", "Opportunity Owner", "Current Handler",
  "Stage", "Status", "Created At", "Created Month", "Expected Close Month",
  "Stage Aging (days)", "Stage SLA (days)", "Handler Aging (days)",
  "Working With", "Working With Aging (days)",
  "Support Needed", "Support Type", "Support Note",
  "Won At", "Lost At", "Lost Reason", "Lost Note", "Created By", "Updated At",
];

// Use genuine Excel Date values, not localized text. Date-only values keep
// their calendar date, while UTC/offset instants use Thailand business dates.
export function toBangkokExcelDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const dt=new Date(value.getTime()+7*3600000);
    return new Date(Date.UTC(dt.getUTCFullYear(),dt.getUTCMonth(),dt.getUTCDate()));
  }
  const raw=String(value).trim();
  const plain=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (plain) {
    const result=new Date(Date.UTC(+plain[1],+plain[2]-1,+plain[3]));
    return result.toISOString().slice(0,10)===raw ? result : null;
  }
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return null;
  const ms=Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  const dt=new Date(ms+7*3600000);
  return new Date(Date.UTC(dt.getUTCFullYear(),dt.getUTCMonth(),dt.getUTCDate()));
}

export function monthKeyToExcelDate(value) {
  const match=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(value||""));
  return match ? new Date(Date.UTC(+match[1],+match[2]-1,1)) : null;
}

export function pipelineExportRows(ops, maps) {
  const dict = (key, id) => maps?.[key]?.[id]?.name || "";
  return ops.map((o) => [
    String(o.id ?? ""), String(o.customer_name ?? ""), String(o.business_id ?? ""), o.customer_type || "",
    o.sales_channel || "", o.partner_name || "", o.contact_name || "", String(o.contact_phone ?? ""), o.remark || "",
    dict("category", o.product_category_id), o.product_details || "",
    o.quantity ?? null, o.price_per_sub ?? null, o.oc ?? null, o.contract_period ?? null,
    Number(o.pipeline_value || 0),
    dict("scenario", o.scenario_id), o.ccp_check_result || "",
    dict("region", o.region_id), dict("territory", o.territory_id),
    dict("member", o.owner_id), dict("member", o.current_handler_id),
    dict("stage", o.stage_id), STATUS_LABELS[o.status] || o.status,
    toBangkokExcelDate(o.created_date), o.created_month || "", monthKeyToExcelDate(o.expected_close_month),
    o.stage_entered_at ? agingDays(o.stage_entered_at) : null, maps?.stage?.[o.stage_id]?.sla_days ?? null, o.handler_since ? agingDays(o.handler_since) : null,
    o.working_with || "", o.working_with ? agingDays(o.working_with_since) : null,
    o.support_needed ? "Yes" : "No", o.support_type || "", o.support_note || "",
    toBangkokExcelDate(o.won_at), toBangkokExcelDate(o.lost_at), dict("lostReason", o.lost_reason_id), o.lost_note || "",
    dict("member", o.created_by_user_id), toBangkokExcelDate(o.updated_date),
  ]);
}

export function buildPipelineWorkbook(ops, maps, ExcelJS) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "B2B GEO Pipeline";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Pipelines", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = PIPELINE_EXPORT_HEADERS.map((name, index) => ({
    header: name, key: "field_" + index, width: [2, 6, 7, 20, 21, 22].includes(index) ? 24 : 18,
  }));
  const rows = pipelineExportRows(ops, maps);
  rows.forEach((row) => sheet.addRow(row));
  sheet.autoFilter = { from: "A1", to: sheet.getRow(1).getCell(PIPELINE_EXPORT_HEADERS.length).address };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF26334A" } };
  sheet.getRow(1).alignment = { vertical: "middle", wrapText: true };
  sheet.getRow(1).height = 32;
  const financialIndexes = [12, 13, 15]; // 0-based money columns
  financialIndexes.forEach((i) => { sheet.getColumn(i + 1).numFmt = '#,##0.00;[Red](#,##0.00)'; });
  sheet.getColumn(3).numFmt = "@"; // Business ID
  sheet.getColumn(8).numFmt = "@"; // Phone
  [25, 36, 37, 41].forEach((column) => { sheet.getColumn(column).numFmt = "dd mmm yyyy"; });
  sheet.getColumn(27).numFmt = "mmm yyyy"; // Expected Close Month as a real Date
  sheet.getColumn(26).numFmt = "@"; // Created Month is a YYYY-MM identifier
  return workbook;
}

export async function downloadPipelineExcel(ops, maps) {
  // Lazy-load ExcelJS only when an export is requested.
  const imported = await import("exceljs");
  const ExcelJS = imported.default || imported;
  const workbook = buildPipelineWorkbook(ops, maps, ExcelJS);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = "B2B_GEO_Pipeline_" + new Date().toISOString().slice(0, 10) + ".xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Defer revocation until after the browser consumes the download click.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
