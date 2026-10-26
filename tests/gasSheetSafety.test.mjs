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

test("Apps Script writes many new Pipeline rows in one contiguous setValues call", () => {
  const operations=[];
  const headers=["opportunity_id","customer_name","pipeline_value"];
  const original={opportunity_id:"OPP1",customer_name:"original",pipeline_value:100};
  const records=[original,
    {opportunity_id:"OPP2",customer_name:"second",pipeline_value:200},
    {opportunity_id:"OPP3",customer_name:"third",pipeline_value:300},
  ];
  const ws={
    getMaxRows(){return 2;},
    insertRowsAfter(at,amount){operations.push(["resize",at,amount]);},
    getRange(row,col,rowCount,colCount){
      return {
        setNumberFormat(fmt){operations.push(["format",row,col,rowCount,fmt]);return this;},
        setValues(values){operations.push(["write",row,col,rowCount,values]);return this;},
      };
    },
  };
  const state={
    tables:{"B2B_GEO_Pipeline_DB.xlsx|Pipelines":{headers,rows:records}},
    loaded:{"B2B_GEO_Pipeline_DB.xlsx|Pipelines":{
      headers:[...headers],rows:[original],json:[JSON.stringify(original)]
    }},
    book_(){return {getSheetByName:()=>ws};}
  };
  ctx.SheetStore_.prototype.writeDirty_.call(state,{
    file:"B2B_GEO_Pipeline_DB.xlsx",sheet:"Pipelines"
  });
  const writes=operations.filter(x=>x[0]==="write");
  assert.equal(writes.length,1);
  assert.equal(writes[0][1],3);
  assert.equal(writes[0][3],2);
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0][4])),[
    ["OPP2","second",200],["OPP3","third",300]
  ]);
  assert.ok(operations.some(x=>x[0]==="resize"));
});

test("missing configured runtime sheet fails closed with identifiable error code", () => {
  const store = new ctx.SheetStore_();
  store.book_ = () => ({getSheetByName: () => null});
  assert.throws(() => store.table("B2B_GEO_Pipeline_DB.xlsx", "Pipelines"),
    (error) => error.status === 503 && error.publicCode === "REQUIRED_SHEET_MISSING");
});

test("runtime schema rejects missing columns and duplicate headers rather than returning empty rows", () => {
  ctx.GEO_CONTRACT = {access: {files: {
    "B2B_GEO_Pipeline_DB.xlsx": {sheets: {Pipelines: {primary_key: "opportunity_id"}}},
  }}};
  const headers = ["opportunity_id","business_id","customer_name","region_id",
    "owner_user_id","current_handler_user_id","stage_id","status","expected_close_month","updated_at"];
  assert.doesNotThrow(() => ctx.geoAssertSheetSchema_("B2B_GEO_Pipeline_DB.xlsx", "Pipelines", headers));
  assert.throws(() => ctx.geoAssertSheetSchema_("B2B_GEO_Pipeline_DB.xlsx", "Pipelines",
    headers.filter(h => h !== "region_id")),
  e => e.status === 503 && e.publicCode === "SCHEMA_MISMATCH");
  assert.throws(() => ctx.geoAssertSheetSchema_("B2B_GEO_Pipeline_DB.xlsx", "Pipelines",
    [...headers, "status"]), e => e.publicCode === "SCHEMA_MISMATCH");
});

test("Apps Script refuses interior blank rows rather than overwriting the wrong physical row", () => {
  const headers = ["opportunity_id","customer_name","business_id","region_id","owner_user_id","current_handler_user_id","stage_id","status","expected_close_month","updated_at"];
  const values = [headers,["OPP1","First"],["",""],["OPP3","Third"]];
  const ws = {
    getLastRow(){return values.length;},
    getLastColumn(){return headers.length;},
    getRange(){return {getValues(){return values;}};},
  };
  const state = {
    tables:{},loaded:{},
    book_(){return {getSheetByName(){return ws;}};},
  };
  assert.throws(
    () => ctx.SheetStore_.prototype.table.call(state,"B2B_GEO_Pipeline_DB.xlsx","Pipelines"),
    /interior blank row/
  );
});

test("Apps Script refuses duplicate Pipeline IDs before attempting an update", () => {
  const headers = ["opportunity_id","customer_name","business_id","region_id","owner_user_id","current_handler_user_id","stage_id","status","expected_close_month","updated_at"];
  const values = [headers,["OPP1","First"],["OPP1","Second"]];
  const ws = {
    getLastRow(){return values.length;},
    getLastColumn(){return headers.length;},
    getRange(){return {getValues(){return values;}};},
  };
  const state = {
    tables:{},loaded:{},
    book_(){return {getSheetByName(){return ws;}};},
  };
  assert.throws(
    () => ctx.SheetStore_.prototype.table.call(state,"B2B_GEO_Pipeline_DB.xlsx","Pipelines"),
    /duplicate opportunity_id/
  );
});
