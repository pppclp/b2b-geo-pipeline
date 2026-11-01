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

import { originalSourceIdentity, historicalRegionForWorkbook } from "../src/lib/historicalSourceIdentity.js";

test("all eight actual approved regional filenames resolve without altering physical-file identity",()=>{
  const names={
    "Pipeline BMA East-2(1).xlsx":"BMA-E","Pipeline BMA West-2(1).xlsx":"BMA-W",
    "Pipeline CW-2(1).xlsx":"CW","Pipeline East(1).xlsx":"E",
    "Pipeline North(1).xlsx":"N","Pipeline NE1(1).xlsx":"NE1",
    "Pipeline NE2(1).xlsx":"NE2","Pipeline South(1).xlsx":"S",
  };
  for(const [name,region] of Object.entries(names)){
    assert.equal(historicalRegionForWorkbook(name),region);
  }
  assert.equal(historicalRegionForWorkbook("Pipeline Unknown.xlsx"),null);
});

test("separate physical Excel rows sharing legacy Source ID MUST be distinct Opportunities",()=>{
  const common={source_system:"Legacy Spreadsheet",
    source_workbook:"Pipeline BMA East-2(1).xlsx",source_sheet:"Pipeline",
    source_record_id:"DOC-79e97612cde3acfee14cfb26a78e0ddd-R124"};
  const a=originalSourceIdentity({...common,source_row:4});
  const b=originalSourceIdentity({...common,source_row:29});
  assert.notEqual(a.source_record_id,b.source_record_id);
  assert.equal(a.source_legacy_record_id,b.source_legacy_record_id);
  assert.match(a.source_record_id,/PIPELINE BMA EAST-2.*\|4$/);
  assert.match(b.source_record_id,/PIPELINE BMA EAST-2.*\|29$/);
  assert.equal(originalSourceIdentity({...common,source_row:4,
    source_workbook:"Pipeline BMA East-2.xlsx"}).source_record_id,a.source_record_id);
});

test("source identities fail closed when row, source sheet, or workbook identity cannot be proven",()=>{
  const base={source_system:"Legacy Spreadsheet",
    source_workbook:"Pipeline East(1).xlsx",source_record_id:"DOC-TEST"};
  assert.throws(()=>originalSourceIdentity({...base,source_row:1}),/Source Row/);
  assert.throws(()=>originalSourceIdentity({...base,source_row:"not a number"}),/Source Row/);
  assert.throws(()=>originalSourceIdentity({...base,source_row:125,source_sheet:"Pipeline (Test)"}),/approved Pipeline/);
  assert.throws(()=>originalSourceIdentity({...base,source_row:125,source_workbook:"Unknown.xlsx"}),/approved regional/);
  assert.throws(()=>originalSourceIdentity({...base,source_row:125,source_workbook:""}),/together/);
});
