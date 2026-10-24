import test from "node:test";
import assert from "node:assert/strict";
import {
 PIPELINE_FILTER_LABELS, QUICK_FILTER_KEYS, ADVANCED_FILTER_KEYS,
 DEFAULT_PIPELINE_FILTERS, visibleActiveFilters, advancedFilterCount,
 showQuickRegion, showQuickOwner, allowedAeOwners,
 shouldClearOwnerOnRegionChange, matchesPipelineSearch,
} from "../src/lib/pipelineFilterUi.js";

test("exact English labels and group membership preserve all requested filters",()=>{
  const wanted={
    created_month:"Created Month",close_month:"Expected Close Month",
    region:"Region",owner:"AE Owner",handler:"Current Handler",
    stage:"Stage",status:"Status",product_category:"Product Category",
    scenario:"Scenario",working_with:"Working With",support:"Support Needed",
  };
  for(const [key,label] of Object.entries(wanted))
    assert.equal(PIPELINE_FILTER_LABELS[key],label);
  for(const key of Object.keys(wanted))
    assert.ok([...QUICK_FILTER_KEYS,...ADVANCED_FILTER_KEYS].includes(key),`Filter missing: ${key}`);
  for(const key of ["sales_channel","ccp_check_result"])
    assert.ok(ADVANCED_FILTER_KEYS.includes(key));
});

test("default Open is not an active chip, explicit All Statuses is a chip",()=>{
  assert.deepEqual(visibleActiveFilters(DEFAULT_PIPELINE_FILTERS),[]);
  const selected={status:"all",region:"R1",handler:"SM1",support:"0"};
  assert.deepEqual(visibleActiveFilters(selected),Object.entries(selected));
  assert.equal(advancedFilterCount(selected,{app_role:"management"}),2);
  assert.equal(advancedFilterCount(selected,{app_role:"sm"}),3);
  assert.equal(advancedFilterCount({status:"open",close_month:"2026-10"}),0);
});

test("AE and single-region SM hide unnecessary quick owner/region controls",()=>{
  assert.equal(showQuickOwner({app_role:"ae",region_ids:["R1"]}),false);
  assert.equal(showQuickOwner({app_role:"sm",region_ids:["R1"]}),false);
  assert.equal(showQuickRegion({app_role:"sm",region_ids:["R1"]}),false);
  assert.equal(showQuickRegion({app_role:"sm",region_ids:["R1","R2"]}),true);
  assert.equal(showQuickRegion({app_role:"management",region_ids:["R1"]}),true);
  assert.equal(showQuickRegion({app_role:"ae",region_ids:["R1","R2"]}),true);
});

test("owner options are scoped by authorized Pipelines and dependent on Region",()=>{
  const members=[
    {id:"A1",name:"Pareeya",app_role:"ae",active:true,region_ids:["R1"],employee_id:"111"},
    {id:"A2",name:"Ongard",app_role:"ae",active:true,region_ids:["R2"],employee_id:"222"},
    {id:"A3",name:"Sarawut",app_role:"ae",active:true,region_ids:["R1"],employee_id:"333"},
    {id:"S1",name:"Manager",app_role:"sm",active:true,region_ids:["R1"]},
  ];
  const scoped=[
    {owner_id:"A1",region_id:"R1"},
    {owner_id:"A2",region_id:"R2"},
  ];
  assert.deepEqual(allowedAeOwners(members,scoped,"R1").map(m=>m.id),["A1"]);
  assert.equal(shouldClearOwnerOnRegionChange("A2","R1",members,scoped),true);
  assert.equal(shouldClearOwnerOnRegionChange("A1","R1",members,scoped),false);
  assert.equal(shouldClearOwnerOnRegionChange("A2","",members,scoped),false);
  assert.deepEqual(allowedAeOwners(members,scoped,"").map(m=>m.id),["A2","A1"]);
});

test("primary toolbar stays minimal and rarely-used filters remain available",()=>{
  assert.deepEqual(QUICK_FILTER_KEYS,["search","close_month","region","status"]);
  for(const key of ["owner","stage","handler","working_with","scenario","ccp_check_result",
    "product_category","support","sales_channel","created_month"])
    assert.ok(ADVANCED_FILTER_KEYS.includes(key),key);
  assert.equal(showQuickOwner({app_role:"management"}),true);
  assert.equal(showQuickOwner({app_role:"admin"}),true);
  assert.equal(showQuickOwner({app_role:"ae"}),false);
});

test("Pipeline search matches customer name, business ID, opportunity ID, ignores case and whitespace",()=>{
 const op={id:"OPP0012",customer_name:"ABC Healthcare",business_id:"0105527001234"};
 for(const search of ["  healthcare  ","ABC","0105527","opp0012",""])
   assert.equal(matchesPipelineSearch(op,search),true,search);
 for(const search of ["different","99999"])
   assert.equal(matchesPipelineSearch(op,search),false,search);
 assert.equal(matchesPipelineSearch(null,""),true);
 assert.equal(matchesPipelineSearch(null,"ABC"),false);
});
