import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {parseImportXlsx, readImportFile} from "../src/lib/importWorkbook.js";

async function makeWorkbook(rows) {
 const wb=new ExcelJS.Workbook();
 const ws=wb.addWorksheet("Opportunities");
 for(const row of rows) ws.addRow(row);
 return wb.xlsx.writeBuffer();
}
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
test("xlsx import enforces 200-row API limit before preview",async()=>{
 const data=await makeWorkbook([["Customer Name"],...Array.from({length:201},(_,i)=>["Acme "+i])]);
 await assert.rejects(()=>parseImportXlsx(data),/200 data rows/);
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
