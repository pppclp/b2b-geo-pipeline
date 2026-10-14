import test from "node:test";
import assert from "node:assert/strict";
import { getStageSla, isStageOverdue, optionsForField } from "../src/lib/slaConfig.js";

test("Stage SLA overrides the global threshold only when valid", () => {
  const stages = [{ stage_id: "STG001", sla_days: 5, active: true, day_type: "calendar" }];
  assert.deepEqual(getStageSla("STG001", stages, 14), { days: 5, source: "stage" });
  assert.deepEqual(getStageSla("STG002", stages, 14), { days: 14, source: "global" });
});
test("Business-day SLA must not be evaluated against calendar days", () => {
  assert.deepEqual(getStageSla("STG001", [{ stage_id:"STG001",sla_days:12,active:true,day_type:"business" }],14), {days:null,source:"pending_business_calendar"});
});
test("Stage overdue compares only open opportunities with stage-specific threshold", () => {
  const rules = [{stage_id:"STG001",sla_days:5,active:true,day_type:"calendar"}];
  const op={status:"open",stage_id:"STG001",stage_entered_at:"2026-10-01"};
  assert.equal(isStageOverdue(op,rules,14,()=>6),true);
  assert.equal(isStageOverdue(op,rules,14,()=>5),false);
  assert.equal(isStageOverdue({...op,status:"won"},rules,14,()=>30),false);
});
test("Only active matching dropdown options override defaults", () => {
  const options=[{field_key:"sales_channel",value:"a",label:"Channel A",order:1,active:true},{field_key:"sales_channel",value:"b",label:"Channel B",active:false}];
  assert.deepEqual(optionsForField(options,"sales_channel",["Fallback"]),[{value:"a",label:"Channel A"}]);
  assert.deepEqual(optionsForField(options,"customer_type",["SME"]),[{value:"SME",label:"SME"}]);
});
