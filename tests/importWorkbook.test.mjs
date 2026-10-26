import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {parseImportXlsx, readImportFile, parseImportCreatedMonth,parseImportSourceDate} from "../src/lib/importWorkbook.js";

async function makeWorkbook(rows) {
 const wb=new ExcelJS.Workbook();
 const ws=wb.addWorksheet("Opportunities");
 for(const row of rows) ws.addRow(row);
 return wb.xlsx.writeBuffer();
}
test("historical 17 named headers retain 19 physical columns and source remarks", async()=>{
 const header=["Create Month","Business ID","Customer Type","Customer Name","Sales Code",
  "Sale Name","Channel","Region","Province","Product Category","รายละเอียดสินค้า",
  "Sub","RC","Net RC","OC","Monthly Sale Plan","Stage (Current)","",""];
 const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet("All Regions");
 ws.addRow(header);
 ws.addRow(["4-มิ.ย.-26","","Industrial","Synthetic Corp","SYNTH-1","Synthetic Seller",
  "AE B2B GEO","East","Synthetic Area","Broadband","FTTH","1","499","499","",
  "12 month","ต.ค.-26","Stage 1. Offer","Remark remains"]);
 const parsed=await parseImportXlsx(await wb.xlsx.writeBuffer());
 assert.equal(parsed.headers.length,19);
 assert.equal(parsed.rows[0].length,19);
 assert.equal(parsed.rows[0][18],"Remark remains");
});

test("xlsx import reads bilingual headers and preserves formatted ID zeroes",async()=>{
 const wb=new ExcelJS.Workbook();
 const ws=wb.addWorksheet("Opportunities");
 ws.addRow(["ชื่อลูกค้า","เลขทะเบียนนิติบุคคล","Expected Close Month","Price per Sub"]);
 ws.getRow(2).getCell(1).value="บริษัททดสอบ";
 ws.getRow(2).getCell(2).value=123;
 ws.getRow(2).getCell(2).numFmt="0000000000000";
 ws.getRow(2).getCell(3).value=new Date("2026-12-01T00:00:00Z");
 ws.getRow(2).getCell(4).value=349;
 const parsed=await parseImportXlsx(await wb.xlsx.writeBuffer());
 assert.deepEqual(parsed.headers,["ชื่อลูกค้า","เลขทะเบียนนิติบุคคล","Expected Close Month","Price per Sub"]);
 assert.deepEqual(parsed.rows,[["บริษัททดสอบ","0000000000123","2026-12","349"]]);
});
test("styled blank rows through row 500 do not exceed the 200 valued-row limit", async()=>{
  const wb=new ExcelJS.Workbook();
  const ws=wb.addWorksheet("Pipelines");
  ws.addRow(["Business ID", "Customer Name"]);
  ws.addRow(["0001234567890", "Test customer"]);
  ws.getRow(500).getCell(1).numFmt="@";
  ws.getRow(500).getCell(2).font={bold:true};
  const parsed=await parseImportXlsx(await wb.xlsx.writeBuffer());
  assert.equal(parsed.rows.length,1);
  assert.equal(parsed.rowNumbers[0],2);
  assert.equal(parsed.rows[0][0],"0001234567890");
});
test("xlsx import rejects formulas instead of silently importing formula code",async()=>{
 const data=await makeWorkbook([["Customer Name"],[{formula:'1+1',result:2}]]);
 await assert.rejects(()=>parseImportXlsx(data),/formulas are not supported/i);
});
test("xlsx preview accepts 239 rows and enforces a 400-row safety ceiling",async()=>{
 const okay=await makeWorkbook([["Customer Name"],...Array.from({length:239},(_,i)=>["Synthetic Account "+i])]);
 assert.equal((await parseImportXlsx(okay)).rows.length,239);
 const data=await makeWorkbook([["Customer Name"],...Array.from({length:401},(_,i)=>["Synthetic Account "+i])]);
 await assert.rejects(()=>parseImportXlsx(data),/400 data rows/);
});
test("safe input handling rejects unknown and oversized files",async()=>{
 await assert.rejects(()=>readImportFile({name:"file.xls",size:22}),/Choose a/);
 await assert.rejects(()=>readImportFile({name:"file.xlsx",size:10*1024*1024}),/5 MB/);
});

test("CSV import continues to work while XLSX is supported",async()=>{
  const sample="Customer Name,Business ID\\nAlpha,0012345";
  const csvFile={name:"leads.csv",size:sample.length,text:async()=>sample};
  const parser=(text)=>text.split("\\n").map((row)=>row.split(","));
  const result=await readImportFile(csvFile,parser);
  assert.deepEqual(result.headers,["Customer Name","Business ID"]);
  assert.deepEqual(result.rows,[["Alpha","0012345"]]);
});

test("legacy source Create Month and Created Month parse only explicit unambiguous dates",()=>{
  for(const [value,expected] of [
    ["1-Jul-26","2026-07"],["Jul-26","2026-07"],
    ["2026-07","2026-07"],["2026-07-01","2026-07"],
    ["31-Dec-99","1999-12"],["1-Jan-00","2000-01"],
    ["2024-02-29","2024-02"],["  Oct-26  ","2026-10"],
    ["4-มิ.ย.-26","2026-06"],["25-Sep_26","2026-09"]
  ])assert.equal(parseImportCreatedMonth(value),expected,value);
  for(const value of [
    "","2026-13","2026-00","31-Feb-26","2026-02-30","2025-02-29",
    "01/07/2026","07/01/2026","46204","2026/07","2026-07-01T00:00:00Z",
    "1-Hello-26","2026-07-00","0000-01","2101-01"
  ])assert.equal(parseImportCreatedMonth(value),null,value);
});

test("Excel date values and text-formatted dates retain source month and original 13-digit ID",async()=>{
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet("Legacy Pipelines");
  sheet.addRow(["Create Month","Created Month","Business ID","Customer Name"]);
  sheet.getCell("A2").value=new Date("2026-07-01T00:00:00.000Z");
  sheet.getCell("A2").numFmt="dd-mmm-yy";
  sheet.getCell("B2").value="1-Jul-26";
  sheet.getCell("B2").numFmt="@";
  sheet.getCell("C2").value=123;
  sheet.getCell("C2").numFmt="0000000000000";
  sheet.getCell("D2").value="Synthetic Account";
  const parsed=await parseImportXlsx(await workbook.xlsx.writeBuffer());
  assert.equal(parseImportCreatedMonth(parsed.rows[0][0]),"2026-07");
  assert.equal(parseImportCreatedMonth(parsed.rows[0][1]),"2026-07");
  assert.equal(parsed.rows[0][2],"0000000000123");
});
test("Ambiguous Excel raw numeric serial cannot silently become imported historical month",async()=>{
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet("Legacy Pipelines");
  sheet.addRow(["Create Month","Customer Name"]);
  sheet.addRow([46204,"Synthetic Account"]);
  const parsed=await parseImportXlsx(await workbook.xlsx.writeBuffer());
  assert.equal(parsed.rows[0][0],"46204");
  assert.equal(parseImportCreatedMonth(parsed.rows[0][0]),null);
});

test("historical calendar dates require an unambiguous real day",()=>{
  assert.equal(parseImportSourceDate("2026-07-01"),"2026-07-01");
  assert.equal(parseImportSourceDate("1-Jul-26"),"2026-07-01");
  assert.equal(parseImportSourceDate("4-มิ.ย.-26"),"2026-06-04");
  assert.equal(parseImportSourceDate("25-Sep_26"),"2026-09-25");
  assert.equal(parseImportSourceDate("31-Dec-99"),"1999-12-31");
  for(const bad of ["01/07/2026","2026-02-30","2026-00-10","46204","2026-07",
    "2026-07-01T00:00:00Z","29-Feb-25"]){
    assert.equal(parseImportSourceDate(bad),null,bad);
  }
});
