import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  quickViewCounts, activePipelineView, switchPipelineView, matchesPipelineFilters
} from "../src/lib/pipelineListFilters.js";

const context = {
  master: { WorkingWithOption: [] },
  maps: { stage: { STG1:{sla_days:7}, STG2:{sla_days:14}, STG3:{sla_days:14} } },
  nowMonth: "2026-10",
  config: { internal_task_sla_days: 3 },
};
const data = [
  { id:"1", status:"open", region_id:"R1", product_category_id:"CAT1",
    expected_close_month:"2026-10", customer_name:"A", owner_id:"AE1",
    current_handler_id:"MGMT1", stage_id:"STG1", pipeline_value:100,
    support_needed:true, stage_entered_at:"2020-01-01T00:00:00Z" },
  { id:"2", status:"open", region_id:"R1", product_category_id:"CAT1",
    expected_close_month:"2026-10", customer_name:"B", owner_id:"AE1",
    current_handler_id:"AE1", stage_id:"STG2", pipeline_value:120,
    support_needed:false },
  { id:"3", status:"open", region_id:"R2", product_category_id:"CAT1",
    expected_close_month:"2026-10", customer_name:"C", owner_id:"AE2",
    current_handler_id:"MGMT1", stage_id:"STG2", pipeline_value:210,
    support_needed:true },
  { id:"4", status:"open", region_id:"R1", product_category_id:"CAT2",
    expected_close_month:"2026-10", customer_name:"D", owner_id:"AE2",
    current_handler_id:"MGMT1", stage_id:"STG3", pipeline_value:160,
    support_needed:true, stage_entered_at:"2020-01-01T00:00:00Z" },
  { id:"5", status:"won", region_id:"R1", product_category_id:"CAT1",
    expected_close_month:"2026-10", customer_name:"E", owner_id:"AE1",
    current_handler_id:"MGMT1", stage_id:"STG3", pipeline_value:100,
    support_needed:true },
  { id:"6", status:"open", region_id:"R1", product_category_id:"CAT1",
    expected_close_month:"2026-11", customer_name:"F", owner_id:"AE1",
    current_handler_id:"MGMT1", stage_id:"STG3", pipeline_value:100,
    support_needed:true, stage_entered_at:"2020-01-01T00:00:00Z" },
];

test("work view counts respond to Region, Close Month, Product Category, and advanced AE Owner", () => {
  const base = { status:"open", region:"R1", close_month:"2026-10", product_category:"CAT1" };
  assert.deepEqual(quickViewCounts(data,base,"MGMT1",context),
    {all:2,"assigned-to-me":1,"support-needed":1,"stage-overdue":1,"due-this-month":2});
  const allRegions = {...base,region:""};
  assert.deepEqual(quickViewCounts(data,allRegions,"MGMT1",context),
    {all:3,"assigned-to-me":2,"support-needed":2,"stage-overdue":1,"due-this-month":3});
  const otherCategory = {...base,product_category:"CAT2"};
  assert.deepEqual(quickViewCounts(data,otherCategory,"MGMT1",context),
    {all:1,"assigned-to-me":1,"support-needed":1,"stage-overdue":1,"due-this-month":1});
  const ownerOnly = {...base,owner:"AE1"};
  assert.deepEqual(quickViewCounts(data,ownerOnly,"MGMT1",context),
    {all:2,"assigned-to-me":1,"support-needed":1,"stage-overdue":1,"due-this-month":2});
  assert.deepEqual(quickViewCounts(data,{...base,owner:"AE2"},"MGMT1",context),
    {all:0,"assigned-to-me":0,"support-needed":0,"stage-overdue":0,"due-this-month":0});
});

test("stage and chosen work view do not shrink unrelated tab counts", () => {
  const filter={status:"open",region:"R1",close_month:"2026-10",product_category:"CAT1",
    support:"1",stage:"STG1"};
  assert.deepEqual(quickViewCounts(data,filter,"MGMT1",context),
    {all:2,"assigned-to-me":1,"support-needed":1,"stage-overdue":1,"due-this-month":2});
  assert.equal(data.filter(o=>matchesPipelineFilters(o,filter,context)).length,1);
});

test("switching views preserves scope, search, stage, and independent advanced filters", () => {
  const base={status:"won",region:"R1",close_month:"2026-10",product_category:"CAT1",
    stage:"STG2",search:"B",owner:"AE1",handler:"OTHER",support:"0"};
  const withMe=switchPipelineView(base,"assigned-to-me","MGMT1");
  assert.equal(withMe.status,"open");
  assert.equal(withMe.handler,"MGMT1");
  assert.equal(withMe.support,"");
  for(const key of ["region","close_month","product_category","stage","search","owner"])
    assert.equal(withMe[key],base[key],key);
  assert.equal(activePipelineView(withMe,"MGMT1"),"assigned-to-me");
  const needs=switchPipelineView(withMe,"support-needed","MGMT1");
  assert.equal(needs.handler,"");
  assert.equal(needs.support,"1");
  assert.equal(activePipelineView(needs,"MGMT1"),"support-needed");
  const all=switchPipelineView(needs,"all","MGMT1");
  assert.equal(activePipelineView(all,"MGMT1"),"all");
  assert.equal(activePipelineView({...all,status:"won"},"MGMT1"),"");
  assert.equal(activePipelineView({...all,handler:"OTHER"},"MGMT1"),"");
  const overdue=switchPipelineView({status:"open",region:"R1",product_category:"CAT1",close_month:"2026-10",support:"1"},"stage-overdue","MGMT1");
  assert.equal(overdue.stuck,"1");
  assert.equal(overdue.support,"");
  assert.equal(overdue.handler,"");
  assert.equal(activePipelineView(overdue,"MGMT1"),"stage-overdue");
  assert.deepEqual(data.filter(o=>matchesPipelineFilters(o,{...overdue,stage:""},context)).map(o=>o.id),["1"]);
  const due=switchPipelineView(overdue,"due-this-month","MGMT1");
  assert.equal(due.stuck,"");
  assert.equal(due.due_this_month,"1");
  assert.equal(activePipelineView(due,"MGMT1"),"due-this-month");
  assert.deepEqual(data.filter(o=>matchesPipelineFilters(o,{...due,stage:""},context)).map(o=>o.id),["1","2"]);
  assert.deepEqual(data.filter(o=>matchesPipelineFilters(o,{...due,stage:"",close_month:"2026-11"},context)).map(o=>o.id),["6"]);
  assert.equal(activePipelineView(switchPipelineView(due,"all","MGMT1"),"MGMT1"),"all");
});

test("Pipeline UI keeps Region pills for multi-region roles and promotes Product Category", () => {
  const source=(path)=>fs.readFileSync(new URL("../"+path,import.meta.url),"utf8");
  const page=source("src/pages/Pipeline.jsx");
  const toolbar=source("src/components/FilterBar.jsx");
  assert.ok(page.includes('const hasRegionQuickFilter = quickRegions.length > 1'));
  assert.ok(page.includes("<RegionQuickFilter regions={quickRegions}"));
  assert.ok(page.includes('showRegionControl={false}'),"No duplicate Region dropdown");
  assert.ok(!page.includes("Quick Views · Open Pipelines within your access scope"));
  assert.ok(page.includes('activePipelineView(filters, profile?.id)'));
  assert.ok(page.includes('quickViewCounts(scopedOpportunities, filters, profile?.id, filterContext)'));
  assert.ok(page.includes("switchPipelineView(filters, viewId, profile?.id)"));
  assert.ok(page.includes('title: "Stage Overdue"'));
  assert.ok(page.includes('"Due This Month"'));
  assert.ok(page.includes('f.due_this_month = "1"'));
  assert.ok(page.includes("setParams(nextParams, { replace: true })"));
  assert.ok(toolbar.includes('label={LABELS.product_category}'));
  assert.ok(toolbar.includes('allText="All Categories"'));
  assert.ok(!toolbar.includes("{showOwner &&"));
  assert.ok(toolbar.includes('profile?.app_role !== "ae"'));
  assert.equal((toolbar.match(/label={LABELS.product_category}/g)||[]).length,1);
});
