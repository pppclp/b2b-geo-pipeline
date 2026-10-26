import test from "node:test";
import assert from "node:assert/strict";
import {MONTHLY_PIPELINE_REPORT_COLUMNS,monthlyPipelineReportRows} from "../server/snapshotReport.js";

test("Monthly report has exactly 13 stable columns and never mutates canonical snapshots",()=>{
 const input={snapshot_period:"2026-10",opportunity_id:"OPP1",customer_name:"Demo",
   pipeline_value:1200,stage_last_updated_at:"2026-10-01T00:00:00Z",
   captured_at:"2026-10-31T00:00:00Z",business_id:"PRIVATE"};
 const copy=structuredClone(input);
 const [row]=monthlyPipelineReportRows([input]);
 assert.equal(MONTHLY_PIPELINE_REPORT_COLUMNS.length,13);
 assert.deepEqual(Object.keys(row),MONTHLY_PIPELINE_REPORT_COLUMNS);
 assert.equal(row.stage_aging_days,30);
 assert.equal(row.pipeline_value,1200);
 assert.equal("business_id" in row,false);
 assert.deepEqual(input,copy);
});

test("Unknown stage-entry timestamp remains blank, never fabricated",()=>{
 const [row]=monthlyPipelineReportRows([{stage_last_updated_at:"",captured_at:"2026-10-31T00:00:00Z"}]);
 assert.equal(row.stage_aging_days,"");
});
