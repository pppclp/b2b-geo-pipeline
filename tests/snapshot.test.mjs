import test from "node:test";
import assert from "node:assert/strict";
import { buildSnapshotRows, replaceSnapshotPeriod, snapshotPeriodValid } from "../server/snapshot.js";
test("reject invalid month and malformed source before changing stored month", () => {
  assert.equal(snapshotPeriodValid("2026-13"), false);
  assert.throws(()=>buildSnapshotRows([], "bad", "", ()=>"SNP1"));
  assert.throws(()=>buildSnapshotRows([{ opportunity_id:"O", status:"open" }, { opportunity_id:"O", status:"won" }],"2026-10","today",()=> "SNP"),/Duplicate/);
});
test("replacement preserves all other months and does not duplicate recaptured Pipeline",()=>{
 const old = [{snapshot_id:"OLD1",snapshot_period:"2026-09",opportunity_id:"O1"},{snapshot_id:"OLD2",snapshot_period:"2026-10",opportunity_id:"O2"}];
 const replacement=[{snapshot_id:"NEW",snapshot_period:"2026-10",opportunity_id:"O3"}];
 assert.deepEqual(replaceSnapshotPeriod(old,"2026-10",replacement),[old[0],replacement[0]]);
 assert.deepEqual(old[1],{snapshot_id:"OLD2",snapshot_period:"2026-10",opportunity_id:"O2"});
});
test("snapshot rows are built from server columns (not browser data)",()=>{
 const rows=buildSnapshotRows([{opportunity_id:"O",owner_user_id:"AE",current_handler_user_id:"SM",handler_since:"since",status:"open",pipeline_value:100,contract_period_months:12,stage_id:"S1"}],"2026-10","captured",()=> "SN1");
 assert.equal(rows[0].contract_value,1200);
 assert.equal(rows[0].handoff_at,"since");
 assert.equal(rows[0].snapshot_id,"SN1");
});
