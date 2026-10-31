import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  STAGE_REVIEW_TRANSITION_ID,
  isMissingSmInfo, requiresStageReview, reviewSignals,
  reviewQueueRows, reviewQueueCounts,
} from "../src/lib/pipelineReviewQueue.js";

const stages=[{id:"STG001",active:true},{id:"STG002",active:true},{id:"STG003",active:true}];
const base={
  id:"SYNTH-1", customer_name:"Synthetic A", business_id:"",
  customer_type:"SME", sales_channel:"AE Self", region_id:"R1",
  owner_id:"AE1", current_handler_id:"AE1", product_category_id:"CAT1",
  stage_id:"STG001", expected_close_month:"2026-11", status:"open",
  scenario_id:"S1", ccp_check_result:"not_in_base", contact_name:"",
  contact_phone:"", price_per_sub:null, quantity:null, contract_period:null,
};
const core={...base,id:"SYNTH-CORE",customer_type:""};
const sm={...base,id:"SYNTH-SM",scenario_id:"",ccp_check_result:"pending"};
const stage={...base,id:"SYNTH-STAGE",stage_id:"STG003"};
const both={...base,id:"SYNTH-BOTH",stage_id:"STG003",customer_type:"",scenario_id:""};
const closed={...base,id:"SYNTH-CLOSED",stage_id:"STG003",status:"won",customer_type:""};

test("Stage 3 stays reviewable while still active; Won and Stage are never conflated",()=>{
 assert.equal(STAGE_REVIEW_TRANSITION_ID,"STG003");
 assert.equal(requiresStageReview(stage,stages),true);
 assert.equal(requiresStageReview(base,stages),false);
 assert.equal(requiresStageReview(closed,stages),false);
 assert.equal(requiresStageReview({...stage,stage_id:"STG002"},stages),false);
 assert.equal(requiresStageReview({...base,stage_id:"STG004"},stages),true);
 assert.equal(requiresStageReview({...base,stage_id:"STG003",status:"lost"},stages),false);
});
test("Data Quality reuses required core fields only; optional historical data remains optional",()=>{
 assert.equal(reviewSignals(base,stages,"ae").any,false);
 assert.deepEqual(reviewSignals(core,stages,"ae").core.map(x=>x.key),["customer_type"]);
 assert.equal(reviewSignals(base,stages,"sm").core.length,0);
 assert.equal(reviewSignals(closed,stages,"sm").any,false);
});
test("SM Info uses the preexisting missing Scenario/CCP+ rule and only the SM role sees it",()=>{
 assert.equal(isMissingSmInfo(sm),true);
 assert.equal(isMissingSmInfo({...sm,scenario_id:"S1",ccp_check_result:"not_in_base"}),false);
 assert.equal(isMissingSmInfo({...sm,status:"won"}),false);
 assert.equal(reviewSignals(sm,stages,"sm").sm,true);
 assert.equal(reviewSignals(sm,stages,"ae").sm,false);
 assert.equal(reviewSignals(sm,stages,"management").sm,false);
 assert.equal(reviewSignals(sm,stages,"admin").sm,false);
});
test("All includes each pipeline only once even if both Stage and data need review",()=>{
 const scoped=[base,core,sm,stage,both,closed];
 assert.deepEqual(reviewQueueRows(scoped,{activeStages:stages,role:"sm"}).map(x=>x.id),
  ["SYNTH-CORE","SYNTH-SM","SYNTH-STAGE","SYNTH-BOTH"]);
 assert.deepEqual(reviewQueueCounts(scoped,stages,"sm"),{all:4,data:3,stage:2,core:2,sm:2});
 assert.deepEqual(reviewQueueCounts(scoped,stages,"ae"),{all:3,data:2,stage:2,core:2,sm:0});
});
test("Core Data and SM Info are independent sub-filters under Incomplete Data",()=>{
 const rows=[core,sm,stage,both];
 const common={activeStages:stages,role:"sm",tab:"data"};
 assert.deepEqual(reviewQueueRows(rows,{...common,dataType:"core"}).map(x=>x.id),["SYNTH-CORE","SYNTH-BOTH"]);
 assert.deepEqual(reviewQueueRows(rows,{...common,dataType:"sm"}).map(x=>x.id),["SYNTH-SM","SYNTH-BOTH"]);
 assert.deepEqual(reviewQueueRows(rows,{...common,dataType:"all"}).map(x=>x.id),
  ["SYNTH-CORE","SYNTH-SM","SYNTH-BOTH"]);
 assert.equal(reviewQueueRows(rows,{activeStages:stages,role:"ae",tab:"data",dataType:"sm"}).length,0);
});
test("Stage review is independent of incompleteness and excludes closed records",()=>{
 const rows=[core,sm,stage,both,closed];
 assert.deepEqual(reviewQueueRows(rows,{activeStages:stages,role:"sm",tab:"stage"}).map(x=>x.id),
  ["SYNTH-STAGE","SYNTH-BOTH"]);
});
test("Search only processes provided scoped records; no all-Pipelines query",()=>{
 const visible=[core,both],outside={...stage,id:"SECRET-9",customer_name:"Outside scope"};
 assert.deepEqual(reviewQueueRows(visible,{activeStages:stages,role:"ae",search:"SYNTH-BOTH"}).map(x=>x.id),["SYNTH-BOTH"]);
 assert.equal(reviewQueueRows(visible,{activeStages:stages,role:"ae",search:outside.customer_name}).length,0);
});
test("Reconfirmation removes the item from the queue only after a real status or Stage change",()=>{
 const reviewed={...stage,stage_id:"STG002"};
 const won={...stage,status:"won"};
 assert.equal(reviewQueueRows([stage],{activeStages:stages}).length,1);
 assert.equal(reviewQueueRows([reviewed],{activeStages:stages}).length,0);
 assert.equal(reviewQueueRows([won],{activeStages:stages}).length,0);
});
test("Review Queue is protected, reachable from a quiet Notification footer and More Filters",()=>{
 const root=new URL("../src/",import.meta.url);
 const read=(file)=>fs.readFileSync(new URL(file,root),"utf8");
 const routes=read("App.jsx"),bell=read("components/HandoffBell.jsx");
 const bar=read("components/FilterBar.jsx"),queue=read("pages/ReviewQueue.jsx");
 const board=read("pages/Pipeline.jsx"),quick=read("components/PipelineQuickView.jsx");
 assert.ok(routes.includes('path="/review-queue"'));
 assert.ok(routes.indexOf('path="/review-queue"')>routes.indexOf('<ProtectedRoute'));
 assert.ok(bell.includes('navigate("/review-queue")'));
 assert.ok(bell.indexOf('navigate("/review-queue")')>bell.indexOf('data.items.map'));
 assert.ok(!bell.includes("review_count"));
 assert.ok(bar.includes('navigate("/review-queue")'));
 assert.ok(bar.includes("Incomplete Data · Missing SM Info · Stage Review"));
 assert.ok(board.includes('navigate("/review-queue?tab=stage")'));
 assert.ok(queue.includes("<PipelineQuickView"));
 assert.ok(queue.includes("<OpportunityForm"));
 assert.ok(quick.includes('missingPipelineCoreFields(op)')); // existing quiet footer stays
});
