import test from "node:test";
import assert from "node:assert/strict";
import { pipelineTaskViews } from "../src/lib/taskOverdue.js";
import { isStageAgingOverdue, overdueReasons, currentPipelineTasks } from "../src/lib/overdueSummary.js";

const now = "2026-10-26T12:00:00.000Z";
const op = {
  id:"OPP1", opportunity_id:"OPP1", status:"open", stage_id:"STG001",
  scenario_id:"SC001", stage_entered_at:"2026-10-18T12:00:00.000Z",
};
const tpl = [
  {task_id:"A", scenario_id:"SC001", stage_id:"STG001", task_name:"Verify", sort_order:1,
    sla_days:3, day_type:"calendar", start_policy:"stage_entry", active:"Yes"},
  {task_id:"B", scenario_id:"SC001", stage_id:"STG001", task_name:"Review", sort_order:2,
    sla_days:2, day_type:"calendar", start_policy:"after_previous", active:"Yes"},
  {task_id:"C", scenario_id:"SC002", stage_id:"STG001", task_name:"Price", sort_order:1,
    sla_days:3, day_type:"calendar", start_policy:"stage_entry", active:"Yes"},
];
test("one Scenario Stage can have multiple separately timed tasks",()=>{
 const tasks=pipelineTaskViews(op,tpl,[],now);
 assert.equal(tasks.length,2);
 assert.equal(tasks[0].status,"in_progress");
 assert.equal(tasks[0].overdue,true);
 assert.equal(tasks[0].overdue_days,5);
 assert.equal(tasks[1].status,"not_started");
 assert.equal(tasks[1].overdue,false);
});
test("subsequent task starts when previous task actually completes",()=>{
 const saved=[{opportunity_id:"OPP1",task_id:"A",scenario_id:"SC001",stage_id:"STG001",
  stage_entered_at:op.stage_entered_at,status:"done",started_at:op.stage_entered_at,
  completed_at:"2026-10-25T12:00:00.000Z",updated_at:"2026-10-25T12:00:00.000Z"}];
 const tasks=pipelineTaskViews(op,tpl,saved,now);
 assert.equal(tasks[0].overdue,false);
 assert.equal(tasks[1].started_at,saved[0].completed_at);
 assert.equal(tasks[1].overdue,false);
});
test("closed pipelines, other scenarios, and stale stage runs are excluded",()=>{
 const old=[{opportunity_id:"OPP1",task_id:"A",scenario_id:"SC001",stage_id:"STG001",
  stage_entered_at:"2026-10-01T12:00:00.000Z",status:"done",completed_at:now}];
 assert.equal(pipelineTaskViews(op,tpl,old,now)[0].status,"in_progress");
 assert.equal(pipelineTaskViews({...op,status:"won"},tpl,[],now)[0].overdue,false);
 assert.equal(pipelineTaskViews({...op,scenario_id:"SC002"},tpl,[],now).length,1);
 assert.equal(pipelineTaskViews({...op,stage_id:"STG003"},tpl,[],now).length,0);
});
test("Overdue flags overlap but the pipeline is counted only once",()=>{
 const tasks=pipelineTaskViews(op,tpl,[],now);
 const summary=overdueReasons(op,{STG001:{sla_days:5}},7,tasks,new Date(now));
 assert.equal(summary.stageAging,true);
 assert.equal(summary.stageSla,true);
 assert.equal(summary.overdueTaskCount,1);
 assert.equal(summary.any,true);
 assert.equal(currentPipelineTasks(op,tasks).length,2);
 assert.equal(isStageAgingOverdue({...op,stage_entered_at:"2026-10-19T12:00:00.000Z"},7,new Date(now)),false);
 assert.equal(overdueReasons({...op,status:"won"},{STG001:{sla_days:5}},7,tasks,new Date(now)).any,false);
});
