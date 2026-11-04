import test from "node:test";
import assert from "node:assert/strict";
import {sortPipelineRows, workingWithTeamLabels, summarizeFilteredPipelines, regionDisplayContext} from "../src/lib/pipelineListPresentation.js";

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

test("Working With is shown for AE and SM selections, including AE handling own Pipeline",()=>{
  const teams=[{id:"PRE",name:"Pre-sales"},{id:"FIN",name:"Pricer"}];
  const op={owner_id:"AE1",current_handler_id:"SM1",working_with_team_ids:"PRE,FIN"};
  assert.deepEqual(workingWithTeamLabels(op,teams),["Pre-sales","Pricer"]);
  assert.deepEqual(workingWithTeamLabels({...op,current_handler_id:"AE1"},teams),["Pre-sales","Pricer"]);
  assert.deepEqual(workingWithTeamLabels({...op,owner_id:"AE2"},teams),["Pre-sales","Pricer"]);
  assert.deepEqual(workingWithTeamLabels({...op,working_with_team_ids:"",working_with:"Pre-sales"},teams),["Pre-sales"]);
  assert.deepEqual(workingWithTeamLabels({...op,working_with_team_ids:"",working_with:""},teams),[]);
});

test("filtered Net RC total counts only matching rows with known numeric persisted value",()=>{
  const rows=[
    {id:"P1", pipeline_value:100.1, status:"open"},
    {id:"P2", pipeline_value:"200.20", status:"open"},
    {id:"P3", pipeline_value:"", status:"open"},
    {id:"P4", pipeline_value:null, status:"open"},
    {id:"P5", pipeline_value:"bad", status:"open"},
    {id:"P6", pipeline_value:9.7, status:"won"},
  ];
  const match = rows.filter(row => row.status === "open");
  assert.deepEqual(summarizeFilteredPipelines(match),{
    count:5,totalNetRc:300.3,missingValueCount:3,
  });
  assert.deepEqual(summarizeFilteredPipelines(rows.filter(row => row.id === "P6")),{
    count:1,totalNetRc:9.7,missingValueCount:0,
  });
  assert.deepEqual(summarizeFilteredPipelines([]),{
    count:0,totalNetRc:0,missingValueCount:0,
  });
  assert.deepEqual(summarizeFilteredPipelines([{pipeline_value:""}]),{
    count:1,totalNetRc:null,missingValueCount:1,
  });
  assert.equal(rows[0].pipeline_value,100.1,"summarize does not mutate records");
});

test("Pipeline List, Board and mobile show chosen team irrespective of Handler role, with filtered totals",async()=>{
  const {readFileSync}=await import("node:fs");
  const read=path=>readFileSync(new URL("../src/"+path,import.meta.url),"utf8");
  const page=read("pages/Pipeline.jsx");
  const card=read("components/PipelineCard.jsx");
  assert.ok(page.includes("const teamLabels = workingWithTeamLabels(o, master?.WorkingWithOption || [])"));
  assert.ok(card.includes("const teams = workingWithTeamLabels(op, master?.WorkingWithOption || [])"));
  assert.ok(!page.includes("smWorkingWithTeamLabels"));
  assert.ok(!card.includes("smWorkingWithTeamLabels"));
  assert.ok(page.includes('aria-label="Filtered Pipeline summary"'));
  assert.ok(page.includes("summarizeFilteredPipelines(filtered)"));
  assert.ok(page.includes("formatTHB(filteredSummary.totalNetRc)"));
  assert.ok(page.includes("filteredSummary.missingValueCount"));
});

test("Working With +N means additional teams, never elapsed days", async () => {
  const { readFileSync } = await import("node:fs");
  const read = p => readFileSync(new URL("../src/" + p, import.meta.url), "utf8");
  const page = read("pages/Pipeline.jsx"), board = read("components/PipelineCard.jsx");
  assert.ok(page.includes("+{teamLabels.length - 1} teams"), "desktop/mobile team count has units");
  assert.ok(board.includes("+{teams.length - 1} teams"), "board team count has units");
  assert.ok(page.includes('"Working With: " + teamLabels.join(", ")'), "hover retains full team names");
  assert.ok(board.includes('"Working With: " + teams.join(", ")'), "board hover retains full team names");
});

test("Management can identify when real backend does not supply complete SLA state", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../src/pages/Pipeline.jsx", import.meta.url), "utf8");
  assert.ok(page.includes("missingServerSlaCount(scopedOpportunities)"));
  assert.ok(page.includes("Backend update required"));
  assert.ok(page.includes('["management", "admin"].includes(profile?.app_role)'));
});
