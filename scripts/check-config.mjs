// Read-only preflight of the nine-sheet B2B GEO Pipeline Config workbook.
// Usage: npm run config:check -- /path/to/B2B_GEO_Pipeline_Config.xlsx
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { loadContract } from "../server/contract.js";

const root = process.cwd();
const filename = path.resolve(process.argv[2] || "data/B2B_GEO_Pipeline_Config.xlsx");
if (!fs.existsSync(filename)) {
  console.error("Config workbook not found: " + filename);
  process.exit(1);
}

const contract = loadContract(path.join(root, "b2b_geo_pipeline.yaml"));
const registered = contract.access.files["B2B_GEO_Pipeline_Config.xlsx"].sheets;
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(filename);
const errors = [];
const rowsBySheet = {};
for (const [name, rule] of Object.entries(registered)) {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) { errors.push("Missing runtime Sheet: " + name); continue; }
  const headers = sheet.getRow(1).values.slice(1).map((v) => String(v ?? "").trim());
  for (const col of contract.columns[rule.entity] || [rule.primary_key]) {
    if (!headers.includes(col)) errors.push(name + ": missing " + col);
  }
  const data = [];
  const ids = new Set();
  for (let i = 2; i <= sheet.rowCount; i++) {
    const rec = {};
    for (let k = 0; k < headers.length; k++) {
      const v = sheet.getRow(i).getCell(k + 1).value;
      rec[headers[k]] = typeof v === "object" && v?.text ? v.text : v;
    }
    if (!Object.values(rec).some((v) => v !== null && v !== undefined && v !== "")) continue;
    const id = String(rec[rule.primary_key] ?? "").trim();
    if (!id) errors.push(name + ": row " + i + " missing " + rule.primary_key);
    else if (ids.has(id)) errors.push(name + ": duplicate " + rule.primary_key + " = " + id);
    ids.add(id);
    data.push(rec);
  }
  rowsBySheet[name] = data;
}
const stageIds = new Set((rowsBySheet.Stages || []).map((r) => String(r.stage_id)));
for (const rule of rowsBySheet.Stage_SLA || []) {
  if (!stageIds.has(String(rule.stage_id))) errors.push("Stage_SLA refers to unknown Stage: " + rule.stage_id);
  if (rule.sla_days !== null && rule.sla_days !== undefined && rule.sla_days !== "") {
    if (!Number.isInteger(Number(rule.sla_days)) || Number(rule.sla_days) <= 0) errors.push("Invalid Stage SLA: " + rule.sla_id);
  }
}
const teamIds = new Set((rowsBySheet.Working_With || []).map((r) => String(r.team_id)));
for (const rule of rowsBySheet.Action_SLA || []) {
  if (rule.working_with_id && !teamIds.has(String(rule.working_with_id))) errors.push("Unknown Working With ID: " + rule.working_with_id);
  if (rule.sla_days !== null && rule.sla_days !== undefined && rule.sla_days !== "") {
    if (!Number.isInteger(Number(rule.sla_days)) || Number(rule.sla_days) <= 0) errors.push("Invalid Action SLA: " + rule.action_sla_id);
  }
}
const validFields = new Set(["sales_channel","customer_type","ccp_check_result"]);
for (const opt of rowsBySheet.Field_Options || []) {
  if (!validFields.has(String(opt.field_key))) errors.push("Unsupported Field Option field_key: " + opt.field_key);
}
if (errors.length) {
  for (const error of errors) console.error("ERROR:", error);
  process.exit(1);
}
console.log("Config valid:", Object.keys(registered).length, "runtime sheets, no missing headers or duplicate IDs.");
console.log("Stage SLA:", (rowsBySheet.Stage_SLA || []).length,
  "| Action SLA:", (rowsBySheet.Action_SLA || []).length,
  "| Field Options:", (rowsBySheet.Field_Options || []).length);
