import test from "node:test";
import assert from "node:assert/strict";
import {sortPipelineRows, workingWithTeamLabels, smWorkingWithTeamLabels, regionDisplayContext} from "../src/lib/pipelineListPresentation.js";

const sample = [
  {id:"B",expected_close_month:"2026-11",pipeline_value:500,stage_entered_at:"2026-10-10T00:00:00Z"},
  {id:"C",expected_close_month:"2026-10",pipeline_value:100,stage_entered_at:"2026-10-12T00:00:00Z"},
  {id:"A",expected_close_month:"2026-10",pipeline_value:300,stage_entered_at:"2026-10-09T00:00:00Z"},
  {id:"D",expected_close_month:"2026-10",pipeline_value:300,stage_entered_at:"2026-10-05T00:00:00Z"},
  {id:"E",expected_close_month:"",pipeline_value:1000,stage_entered_at:"2026-10-01T00:00:00Z"},
];
test("default order uses close month ascending, net RC descending, then oldest stage and stable ID",()=>{
  assert.deepEqual(sortPipelineRows(sample).map(x=>x.id),["D","A","C","B","E"]);
  assert.deepEqual(sample.map(x=>x.id),["B","C","A","D","E"]); // no mutation
});
test("explicit value sort retains standalone value behavior",()=>{
  assert.deepEqual(sortPipelineRows(sample,"value_desc").map(x=>x.id),["E","B","A","D","C"]);
});
test("Working With tags contain only assigned, configured teams",()=>{
  const choices=[{id:"PRE",name:"Presales"},{id:"FIN",name:"Finance"}];
  assert.deepEqual(workingWithTeamLabels({working_with_team_ids:"PRE,FIN,PRE,UNKNOWN"},choices),["Presales","Finance"]);
  assert.deepEqual(workingWithTeamLabels({working_with:"Presales"},choices),["Presales"]);
  assert.deepEqual(workingWithTeamLabels({working_with:"Unlisted"},choices),[]);
  assert.deepEqual(workingWithTeamLabels({},choices),[]);
});
test("Region is a column only for multi-region rows without a selected region",()=>{
  const byId={R1:{name:"BMA East"},R2:{name:"South"}};
  const many=[{region_id:"R1"},{region_id:"R2"}];
  assert.deepEqual(regionDisplayContext(many,byId).showColumn,true);
  assert.equal(regionDisplayContext(many,byId).label,"All Regions · 2");
  assert.deepEqual(regionDisplayContext(many,byId,"R1"),{label:"Region: BMA East",showColumn:false,multi:false});
  assert.equal(regionDisplayContext([{region_id:"R2"}],byId).label,"Region: South");
  assert.equal(regionDisplayContext([],byId,"",["R1"]).label,"Region: BMA East");
});

test("All Regions scope stays visible even when filtered rows contain just one Region",()=>{
  const map={R1:{name:"BMA East"},R2:{name:"South"}};
  const current=[{region_id:"R1"}];
  assert.deepEqual(regionDisplayContext(current,map,"",["R1","R2"]),
    {label:"All Regions · 2",showColumn:true,multi:true});
  assert.deepEqual(regionDisplayContext([],map,"",["R1","R2"]),
    {label:"All Regions · 2",showColumn:true,multi:true});
  assert.deepEqual(regionDisplayContext(current,map,"R1",["R1","R2"]),
    {label:"Region: BMA East",showColumn:false,multi:false});
});

test("Working With is shown inline only for the actual SM handler",()=>{
  const teams=[{id:"PRE",name:"Presales"}];
  const op={owner_id:"AE1",current_handler_id:"SM1",working_with_team_ids:"PRE"};
  assert.deepEqual(smWorkingWithTeamLabels(op,{app_role:"sm"},teams),["Presales"]);
  assert.deepEqual(smWorkingWithTeamLabels(op,{app_role:"SM"},teams),["Presales"]);
  assert.deepEqual(smWorkingWithTeamLabels(op,{app_role:"ae"},teams),[]);
  assert.deepEqual(smWorkingWithTeamLabels(op,undefined,teams),[]);
  assert.deepEqual(smWorkingWithTeamLabels({...op,current_handler_id:"AE1"},{app_role:"sm"},teams),[]);
  assert.deepEqual(smWorkingWithTeamLabels({...op,working_with_team_ids:""},{app_role:"sm"},teams),[]);
});
