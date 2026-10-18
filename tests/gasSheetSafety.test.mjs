import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const code = readFileSync(new URL("../apps-script/Main.js", import.meta.url), "utf8");
const ctx = { console: { log() {}, warn() {}, error() {} } };
runInNewContext(code, ctx, { filename: "apps-script/Main.js" });

test("Apps Script user strings cannot execute formulas; actual amounts remain numeric", () => {
  assert.equal(ctx.geoSafeSheetValue_("=IMPORTXML(\"https://invalid.example\",\"x\")"), "'=IMPORTXML(\"https://invalid.example\",\"x\")");
  assert.equal(ctx.geoSafeSheetValue_("  =SUM(1,2)"), "'  =SUM(1,2)");
  assert.equal(ctx.geoSafeSheetValue_("+cmd"), "'+cmd");
  assert.equal(ctx.geoSafeSheetValue_("-cmd"), "'-cmd");
  assert.equal(ctx.geoSafeSheetValue_("@SUM(1,2)"), "'@SUM(1,2)");
  assert.equal(ctx.geoSafeSheetValue_("0812345678"), "0812345678");
  assert.equal(ctx.geoSafeSheetValue_("2026-10"), "2026-10");
  assert.equal(ctx.geoSafeSheetValue_(123.45), 123.45);
  assert.equal(ctx.geoSafeSheetValue_(null), "");
});

test("Apps Script formats identifiers as text BEFORE persisting changed rows", () => {
  const operations = [];
  const headers = ["business_id", "contact_phone", "expected_close_month", "remark", "pipeline_value"];
  const row = { business_id: "0000000000123", contact_phone: "0812345678", expected_close_month: "2026-10", remark: "safe" ,pipeline_value: 1200};
  const prior = JSON.stringify(row);
  row.remark = "=HYPERLINK(\"https://invalid.example\")";
  const ws = {
    getRange(r,c,rc,cc) {
      return {
        setNumberFormat(fmt) {operations.push({op:"format",r,c,fmt,rc,cc});return this;},
        setValues(values) {operations.push({op:"values",r,c,values:JSON.parse(JSON.stringify(values))});return this;},
      };
    },
  };
  const state = {
    tables:{"Db|Pipelines":{headers,rows:[row]}},
    loaded:{"Db|Pipelines":{headers:[...headers],rows:[row],json:[prior]}},
    book_() {return {getSheetByName() {return ws;}};},
  };
  ctx.SheetStore_.prototype.writeDirty_.call(state,{file:"Db",sheet:"Pipelines"});
  const write = operations.findIndex(x=>x.op==="values");
  assert.ok(write>0);
  assert.ok(operations.slice(0,write).some(x=>x.op==="format"&&x.c===1&&x.fmt==="@"));
  assert.ok(operations.slice(0,write).some(x=>x.op==="format"&&x.c===2&&x.fmt==="@"));
  assert.equal(operations[write].values[0][0],"0000000000123");
  assert.equal(operations[write].values[0][1],"0812345678");
  assert.equal(operations[write].values[0][2],"2026-10");
  assert.match(operations[write].values[0][3],/^'/);
  assert.equal(operations[write].values[0][4],1200);
});

test("Master workbook errors fail the API request instead of silently claiming success",()=>{
  const state={
    dirty:{"Master|Users":{file:"Master",sheet:"Users"}},
    pendingAppends:[],
    pendingCells:[],
    writeDirty_() {throw new Error("quota exceeded");},
  };
  assert.throws(()=>ctx.SheetStore_.prototype.flush.call(state),/Master data save failed for Users/);
});
