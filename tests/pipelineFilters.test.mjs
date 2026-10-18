import test from "node:test";
import assert from "node:assert/strict";
import {
  availableFilterOptions, applyPipelineFilters, filterLayout,
  isPendingSmReview, ownershipGroup, shouldShowDropdown, statusCounts,
} from "../src/lib/pipelineFilters.js";

const ops=[
  {id:"P1",customer_name:"Northern Shop",business_id:"0012345678901",contact_name:"Somchai",
   owner_id:"AE1",current_handler_id:"AE1",region_id:"N",status:"open",stage_id:"S1",
   expected_close_month:"2026-10",product_category_id:"CAT",sales_channel:"AE Self",
   scenario_id:"SC1",ccp_check_result:"enterprise_base",support_needed:false},
  {id:"P2",customer_name:"Central Store",business_id:"999123",contact_name:"Natt",
   owner_id:"AE1",current_handler_id:"SM1",region_id:"N",status:"won",stage_id:"S2",
   expected_close_month:"2026-11",product_category_id:"CAT",sales_channel:"AE B2B GEO",
   scenario_id:"",ccp_check_result:"pending",support_needed:true},
  {id:"P3",customer_name:"Partner Restaurant",business_id:"567",contact_name:"Pim",
   owner_id:"AE2",current_handler_id:"AE1",region_id:"E",status:"lost",stage_id:"S2",
   expected_close_month:"2026-12",product_category_id:"OTHER",sales_channel:"B2B Premium Partner",
   scenario_id:"",ccp_check_result:"",support_needed:false},
  {id:"P4",customer_name:"Archived Deal",business_id:"888",contact_name:"Ladda",
   owner_id:"AE2",current_handler_id:"SM1",region_id:"E",status:"archived",stage_id:"S3",
   expected_close_month:"2026-12",product_category_id:"OTHER",sales_channel:"AE Self"},
];
const ids=(records)=>records.map((op)=>op.id);

test("Search matches customer, full text Business ID (leading zero) and contact",()=>{
  for(const value of ["north", "0012345678901", "somchai"]) {
    assert.deepEqual(ids(applyPipelineFilters(ops,{search:value,status:"all"})),["P1"]);
  }
  assert.deepEqual(ids(applyPipelineFilters(ops,{search:"RESTaurant",status:"all"})),["P3"]);
  assert.deepEqual(ids(applyPipelineFilters(ops,{search:"no match",status:"all"})),[]);
});

test("AE ownership switches divide authorized Pipelines into own, handed off and received",()=>{
  const profile={id:"AE1",app_role:"ae"};
  assert.deepEqual([ownershipGroup(ops[0],"AE1"),ownershipGroup(ops[1],"AE1"),ownershipGroup(ops[2],"AE1")],["mine","sent","received"]);
  assert.deepEqual(ids(applyPipelineFilters(ops,{status:"all",ownership_view:"mine"},{profile})),["P1"]);
  assert.deepEqual(ids(applyPipelineFilters(ops,{status:"all",ownership_view:"sent"},{profile})),["P2"]);
  assert.deepEqual(ids(applyPipelineFilters(ops,{status:"all",ownership_view:"received"},{profile})),["P3"]);
  assert.deepEqual(ids(applyPipelineFilters(ops.slice(0,3),{status:"all",ownership_view:"all"},{profile})),["P1","P2","P3"]);
  // A filter can only narrow the server-authorized array: it never adds P4.
  assert.deepEqual(ids(applyPipelineFilters([ops[0]],{status:"all",ownership_view:"all"},{profile})),["P1"]);
});

test("SM with-me and missing Scenario/CCP+ work on already scoped records",()=>{
  const profile={id:"SM1",app_role:"sm"};
  assert.deepEqual(ids(applyPipelineFilters(ops,{status:"all",with_me:"1"},{profile})),["P2","P4"]);
  assert.deepEqual(ids(applyPipelineFilters(ops,{status:"all",needs_review:"1"},{profile})),["P2","P3","P4"]);
  assert.equal(isPendingSmReview(ops[0]),false);
  assert.equal(isPendingSmReview(ops[1]),true);
});

test("Dropdown values come only from visible Pipeline rows and hide at one option",()=>{
  const maps={
    region:{N:{name:"North"},E:{name:"East"}},
    member:{AE1:{name:"AE One"},AE2:{name:"AE Two"},SM1:{name:"SM One"}},
    stage:{S1:{name:"Prospect"},S2:{name:"Qualified"}},
  };
  const options=availableFilterOptions(ops.slice(0,2),maps);
  assert.deepEqual(options.region.map(x=>x.value),["N"]);
  assert.deepEqual(options.owner.map(x=>x.value),["AE1"]);
  assert.deepEqual(options.stage.map(x=>x.value),["S1","S2"]);
  assert.equal(shouldShowDropdown(options.region),false);
  assert.equal(shouldShowDropdown(options.region,"N"),true);
  assert.equal(shouldShowDropdown(options.stage),true);
  assert.deepEqual(availableFilterOptions([ops[2]],maps).region.map(x=>x.value),["E"]);
});

test("Role layout keeps AE scope switch and management categories separate from extras",()=>{
  const ae=filterLayout("ae");
  const sm=filterLayout("sm");
  const management=filterLayout("management");
  const admin=filterLayout("admin");
  assert.deepEqual(ae.primary,["stage"]);
  assert.ok(!ae.primary.includes("region"));
  assert.ok(sm.primary.includes("owner"));
  assert.ok(sm.more.includes("needs_review"));
  assert.ok(!management.more.includes("needs_review"));
  assert.ok(admin.more.includes("needs_review"));
  assert.ok(management.primary.includes("sales_channel"));
  assert.ok(!management.primary.includes("handler"));
});

test("Status tabs retain stable counts and All includes Archived",()=>{
  assert.deepEqual(statusCounts(ops),{all:4,open:1,won:1,lost:1,archived:1});
  assert.deepEqual(ids(applyPipelineFilters(ops,{status:"open"})),["P1"]);
  assert.deepEqual(ids(applyPipelineFilters(ops,{status:"all"})),["P1","P2","P3","P4"]);
});

test("Multiple filters intersect without widening Region/Owner scope",()=>{
  const r=applyPipelineFilters(ops,{status:"all",region:"N",owner:"AE1",product_category:"CAT",sales_channel:"AE Self"});
  assert.deepEqual(ids(r),["P1"]);
});
