import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { pipelineExportRows, PIPELINE_EXPORT_HEADERS, buildPipelineWorkbook, toBangkokExcelDate, monthKeyToExcelDate } from "../src/lib/pipelineExport.js";

test("real .xlsx rows retain leading zeroes in Business IDs and phone numbers",()=>{
 const one={id:"OPP1",customer_name:"One",business_id:"0012345",contact_phone:"0812345678",pipeline_value:1200,status:"open",stage_id:"S1",region_id:"R1",quantity:2,price_per_sub:600};
 const rows=pipelineExportRows([one],{stage:{S1:{name:"Qualify",sla_days:7}},region:{R1:{name:"East"}}});
 assert.equal(rows.length,1);
 assert.equal(rows[0].length,PIPELINE_EXPORT_HEADERS.length);
 assert.equal(rows[0][2],"0012345");
 assert.equal(rows[0][7],"0812345678");
 assert.equal(rows[0][15],1200);
 assert.equal(rows[0][28],7);
});
test("empty exports still have the correct headers",()=>{
 assert.equal(pipelineExportRows([],{}).length,0);
 assert.equal(PIPELINE_EXPORT_HEADERS[0],"Opportunity ID");
});

test("date columns export native Excel Dates, preserving Bangkok business date", async ()=>{
  const op={
    id:"OPP001",business_id:"0012345678901",contact_phone:"0812345678",created_date:"2026-10-18T19:30:00Z",
    updated_date:"2026-10-19T07:40:00Z",won_at:"2026-10-19",expected_close_month:"2026-11",
    status:"won",pipeline_value:1000
  };
  const wb=buildPipelineWorkbook([op],{},ExcelJS);
  const sheet=wb.getWorksheet("Pipelines");
  assert.ok(sheet.getRow(2).getCell(25).value instanceof Date);
  assert.equal(sheet.getRow(2).getCell(25).value.toISOString().slice(0,10),"2026-10-19");
  assert.equal(sheet.getRow(2).getCell(27).value.toISOString().slice(0,10),"2026-11-01");
  assert.equal(sheet.getColumn(27).numFmt,"mmm yyyy");
  assert.equal(sheet.getColumn(25).numFmt,"dd mmm yyyy");
  assert.equal(sheet.getRow(2).getCell(3).value,"0012345678901");
  assert.equal(sheet.getRow(2).getCell(8).value,"0812345678");
  const bytes=await wb.xlsx.writeBuffer();
  const roundtrip=new ExcelJS.Workbook();
  await roundtrip.xlsx.load(bytes);
  assert.ok(roundtrip.getWorksheet("Pipelines").getRow(2).getCell(25).value instanceof Date);
  assert.equal(roundtrip.getWorksheet("Pipelines").getRow(2).getCell(27).numFmt,"mmm yyyy");
});
test("invalid and empty dates do not become fabricated calendar dates",()=>{
 assert.equal(toBangkokExcelDate(""),null);
 assert.equal(toBangkokExcelDate("not-a-date"),null);
 assert.equal(toBangkokExcelDate("2026-02-30"),null);
 assert.equal(monthKeyToExcelDate("2026-13"),null);
});
