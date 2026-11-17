import test from "node:test";
import assert from "node:assert/strict";
import {sortPipelineRows, workingWithTeamLabels, currentHandlerSummary, summarizeFilteredPipelines, regionDisplayContext} from "../src/lib/pipelineListPresentation.js";

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

test("Current Handler summary prefers selected Working With without changing real user assignment", () => {
  const members={AE1:{app_role:"ae",name:"Somchai"},SM1:{app_role:"sm",name:"Somying"}};
  const teams=[{id:"PRE",name:"Pre-sales"},{id:"FIN",name:"Pricer"},{id:"PRO",name:"Product"}];
  const none=currentHandlerSummary({current_handler_id:"AE1"},members,teams);
  assert.deepEqual(none,{label:"AE",display:"Somchai",title:"Current Handler: AE Somchai",isWorkingWith:false});
  const sm=currentHandlerSummary({current_handler_id:"SM1"},members,teams);
  assert.equal(sm.label,"SM");
  assert.equal(sm.display,"Somying");
  const withOne=currentHandlerSummary({current_handler_id:"SM1",working_with_team_ids:"FIN"},members,teams);
  assert.equal(withOne.label,"Working With");
  assert.equal(withOne.display,"Pricer");
  assert.ok(withOne.title.includes("Current Handler: SM Somying"),"actual handler is still discoverable");
  const withThree=currentHandlerSummary({current_handler_id:"AE1",working_with_team_ids:"PRE,FIN,PRO"},members,teams);
  assert.equal(withThree.display,"Pre-sales +2 teams");
  assert.ok(withThree.title.includes("Pre-sales, Pricer, Product"));
  assert.equal(withThree.isWorkingWith,true);
  const historical=currentHandlerSummary({current_handler_id:"AE1",working_with:"Pricer"},members,teams);
  assert.equal(historical.display,"Pricer");
  assert.equal(currentHandlerSummary({current_handler_id:"AE1",working_with:"Unknown"},members,teams).label,"AE");
});

test("Pipeline list, mobile and Board use one handler summary and filtered totals",async()=>{
  const {readFileSync}=await import("node:fs");
  const read=path=>readFileSync(new URL("../src/"+path,import.meta.url),"utf8");
  const page=read("pages/Pipeline.jsx"),card=read("components/PipelineCard.jsx");
  assert.ok(page.includes("const handlerSummary = currentHandlerSummary(o, maps.member, master?.WorkingWithOption || [])"));
  assert.ok(card.includes("const handlerSummary = currentHandlerSummary(op, maps.member, master?.WorkingWithOption || [])"));
  assert.ok(page.includes("Current Handler</th>"));
  assert.ok(page.includes("AE Owner</th>"));
  assert.ok(!page.includes("AE Owner / Handling"));
  assert.ok(page.indexOf("AE Owner</th>")<page.indexOf("Current Handler</th>"));
  assert.ok(page.indexOf("Current Handler</th>")<page.indexOf("Stage Age / Alerts</th>"));
  assert.ok(page.includes('aria-label="Filtered Pipeline summary"'));
  assert.ok(page.includes("summarizeFilteredPipelines(filtered)"));
  assert.ok(page.includes("formatTHB(filteredSummary.totalNetRc)"));
  assert.ok(page.includes("filteredSummary.missingValueCount"));
});

test("Working With +N means additional teams and tooltip retains actual AE/SM", async () => {
  const {readFileSync}=await import("node:fs");
  const page=readFileSync(new URL("../src/pages/Pipeline.jsx",import.meta.url),"utf8");
  const board=readFileSync(new URL("../src/components/PipelineCard.jsx",import.meta.url),"utf8");
  assert.ok(page.includes("title={handlerSummary.title}"));
  assert.ok(board.includes("title={handlerSummary.title}"));
  assert.ok(!page.includes("+{teamLabels.length - 1}"));
  assert.ok(!board.includes("+{teams.length - 1}"));
});

test("Pipeline page does not show backend diagnostics or sample alerts", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../src/pages/Pipeline.jsx", import.meta.url), "utf8");
  assert.ok(!page.includes("missingServerSlaCount("));
  assert.ok(!page.includes("Backend update required"));
  assert.ok(!page.includes("SLA alerts incomplete"));
  assert.ok(page.includes("<OverdueTags op={o}"));
});

test("Working With prefix is hidden in Pipeline list and board display",async()=>{
  const {readFileSync}=await import("node:fs");
  const load=path=>readFileSync(new URL("../src/"+path,import.meta.url),"utf8");
  const list=load("pages/Pipeline.jsx");
  const board=load("components/PipelineCard.jsx");
  for(const content of [list,board]) {
    assert.ok(content.includes("handlerSummary.isWorkingWith ? handlerSummary.display"));
    assert.ok(!content.includes("{handlerSummary.label} · {handlerSummary.display}"));
  }
  assert.ok(list.includes("!handlerSummary.isWorkingWith && ("));
  assert.ok(list.includes("title={handlerSummary.title}"),"real handler remains available on hover");
});
