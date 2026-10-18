import test from "node:test";
import assert from "node:assert/strict";
import {dashboardCohort,dashboardMetrics,isStageSlaOverdue,isInternalSlaOverdue,validSlaDays} from "../src/lib/dashboardMetrics.js";
const now=new Date("2026-10-18T00:00:00Z");
const opp=[
  {id:"A",status:"open",created_month:"2026-09",expected_close_month:"2026-10",region_id:"R1",stage_id:"S1",stage_entered_at:"2026-10-10T00:00:00Z",working_with:"Enterprise",working_with_since:"2026-10-16T00:00:00Z"},
  {id:"B",status:"won",created_month:"2026-09",expected_close_month:"2026-10",region_id:"R1",stage_id:"S1"},
  {id:"C",status:"lost",created_month:"2026-09",expected_close_month:"2026-11",region_id:"R1"},
  {id:"D",status:"open",created_month:"2026-10",expected_close_month:"2026-10",region_id:"R2",stage_id:"S2",stage_entered_at:"2026-10-02T00:00:00Z"},
];
test("Created counts all statuses, not only open",()=>{
 const v=dashboardMetrics(dashboardCohort(opp,{createdMonth:"2026-09"}));
 assert.equal(v.created.length,3);assert.equal(v.open.length,1);assert.equal(v.won.length,1);assert.equal(v.lost.length,1);
});
test("created, expected close, region filters form one shared intersection",()=>{
 const v=dashboardCohort(opp,{createdMonth:"2026-09",closeMonth:"2026-10",region:"R1"});
 assert.deepEqual(v.map(o=>o.id),["A","B"]);
 const x=dashboardMetrics(v);assert.equal(x.created.length,2);assert.equal(x.open.length,1);assert.equal(x.won.length,1);
});
test("independent stage SLA and internal handoff SLA",()=>{
 const stages={S1:{sla_days:5},S2:{sla_days:20}};
 const v=dashboardMetrics(opp,{stages,internalTaskSlaDays:1,now});
 assert.deepEqual(v.stageOverdue.map(o=>o.id),["A"]);
 assert.deepEqual(v.internalOverdue.map(o=>o.id),["A"]);
 assert.equal(isStageSlaOverdue(opp[0],{S1:{sla_days:""}},now),false);
 assert.equal(isInternalSlaOverdue({...opp[0],working_with_since:""},1,now),false);
 assert.equal(validSlaDays("0"),null);
});
