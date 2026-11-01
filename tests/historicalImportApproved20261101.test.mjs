import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHistoricalDate, normalizeHistoricalMonth } from "../src/lib/historicalDateNormalization.js";
import { approvedHistoricalStage3 } from "../src/lib/approvedHistoricalStage3.js";

test("approved day-first dates, Thai/English months and Excel serial convert without creating guessed dates",()=>{
  assert.equal(normalizeHistoricalDate("04/06/2026"),"2026-06-04");
  assert.equal(normalizeHistoricalDate("4-มิ.ย.-26"),"2026-06-04");
  assert.equal(normalizeHistoricalDate("4-Jun-26"),"2026-06-04");
  assert.equal(normalizeHistoricalDate("46177"),"2026-06-04");
  assert.equal(normalizeHistoricalDate(46296),"2026-10-01");
  assert.equal(normalizeHistoricalDate("31/02/2026"),null);
  assert.equal(normalizeHistoricalDate(""),"");
  assert.equal(normalizeHistoricalDate("not a date"),null);
  assert.equal(normalizeHistoricalMonth("ต.ค.-26"),"2026-10");
  assert.equal(normalizeHistoricalMonth("Oct-26"),"2026-10");
  assert.equal(normalizeHistoricalMonth("2026-10"),"2026-10");
  assert.equal(normalizeHistoricalMonth("31/02/2026"),null);
});

test("historical Stage 3 can be Won on stable legacy file-row identity but never in a normal Create",()=>{
  assert.equal(approvedHistoricalStage3({
    source_system:"Legacy Spreadsheet",
    source_record_id:"DOC-79e97612cde3acfee14cfb26a78e0ddd-R300",
    stage_id:"STG003",status:"won",source_stage_raw:"Stage 3.เปิดบริการ (100%)"
  }),true);
  assert.equal(approvedHistoricalStage3({
    source_system:"Legacy Spreadsheet",source_record_id:"unverified",
    stage_id:"STG003",status:"won"
  }),false);
  assert.equal(approvedHistoricalStage3({
    source_system:"Legacy Spreadsheet",
    source_record_id:"DOC-79e97612cde3acfee14cfb26a78e0ddd-R300",
    stage_id:"STG003",status:"open"
  }),false);
});
