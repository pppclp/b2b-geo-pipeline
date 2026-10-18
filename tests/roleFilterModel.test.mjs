import test from "node:test";
import assert from "node:assert/strict";
import {
  FILTER_LABELS, ROLE_FILTERS, visibleFilterFields, optionsFromVisiblePipelines,
  roleOwnershipMatches, isPendingSmReview, isFilterActive, normalizeFilterSelection,
} from "../src/lib/roleFilterModel.js";

const rows = [
  { id:"P1", region_id:"N", stage_id:"STG01", owner_id:"AE1", current_handler_id:"AE1",
    product_category_id:"CAT1", sales_channel:"AE Self", scenario_id:"SC1", ccp_check_result:"enterprise_base" },
  { id:"P2", region_id:"N", stage_id:"STG02", owner_id:"AE1", current_handler_id:"SM1",
    product_category_id:"CAT1", sales_channel:"AE B2B GEO", scenario_id:"", ccp_check_result:"pending" },
  { id:"P3", region_id:"E", stage_id:"STG02", owner_id:"AE2", current_handler_id:"AE1",
    product_category_id:"CAT2", sales_channel:"AE B2B GEO", scenario_id:"", ccp_check_result:"" },
];

test("Primary Status, close-month and Stage remain present for every role regardless of data",()=>{
  for (const role of ["ae","sm","management","admin"]) {
    assert.deepEqual(visibleFilterFields(role,[]).primary.slice(0,3),
      ["status","close_month","stage"]);
  }
  assert.equal(FILTER_LABELS.stage,"Stage");
  assert.equal(ROLE_FILTERS.ae.primary.includes("region"),false);
});

test("Role layout: AE sees only own workflow; SM AE owners & conditional Region",()=>{
  const ae=visibleFilterFields("ae",["N"]);
  const singleSm=visibleFilterFields("sm",["N"]);
  const doubleSm=visibleFilterFields("sm",["N","NE1"]);
  assert.deepEqual(ae.primary,["status","close_month","stage"]);
  assert.ok(!ae.more.includes("handler"));
  assert.ok(singleSm.primary.includes("owner"));
  assert.ok(!singleSm.primary.includes("region"));
  assert.ok(doubleSm.primary.includes("region"));
  assert.ok(doubleSm.more.includes("needs_review"));
  assert.ok(!ae.more.includes("needs_review"));
});

test("Management and Admin retain analytics filters, with Admin-only review filter",()=>{
  for (const role of ["management","admin"]) {
    const layout=visibleFilterFields(role,["N","E"]);
    for (const field of ["region","owner","product_category","sales_channel"])
      assert.ok(layout.primary.includes(field),role+": "+field);
    for(const field of ["handler","working_with","scenario","ccp_check_result"])
      assert.ok(layout.more.includes(field),role+": "+field);
  }
  assert.equal(visibleFilterFields("management").more.includes("needs_review"),false);
  assert.equal(visibleFilterFields("admin").more.includes("needs_review"),true);
});

test("Option lists use only IDs from already-scoped Pipeline rows",()=>{
  const maps={region:{N:{name:"North"},E:{name:"East"}},
    member:{AE1:{name:"AE One"},AE2:{name:"AE Two"},SM1:{name:"SM One"}},
    stage:{STG01:{name:"Prospect"},STG02:{name:"Proposal"}}};
  const subset=rows.slice(0,2);
  assert.deepEqual(optionsFromVisiblePipelines("owner",subset,maps),
    [{value:"AE1",label:"AE One"}]);
  assert.deepEqual(optionsFromVisiblePipelines("region",subset,maps),
    [{value:"N",label:"North"}]);
  // Presentation options sort by visible label, not by database ID.
  assert.deepEqual(optionsFromVisiblePipelines("stage",subset,maps).map(x=>x.value),
    ["STG02","STG01"]);
  assert.deepEqual(optionsFromVisiblePipelines("stage",[],maps),[]);
  assert.deepEqual(optionsFromVisiblePipelines("owner",[rows[2]],maps),
    [{value:"AE2",label:"AE Two"}]);
  assert.deepEqual(optionsFromVisiblePipelines("handler",subset,maps).map(x=>x.value),
    ["AE1","SM1"]);
});

test("AE commercial ownership preserves handed-off deals and distinguishes incoming work",()=>{
  assert.deepEqual(rows.filter(x=>roleOwnershipMatches(x,"AE1","mine")).map(x=>x.id),["P1","P2"]);
  assert.deepEqual(rows.filter(x=>roleOwnershipMatches(x,"AE1","sent")).map(x=>x.id),["P2"]);
  assert.deepEqual(rows.filter(x=>roleOwnershipMatches(x,"AE1","received")).map(x=>x.id),["P3"]);
  assert.deepEqual(rows.filter(x=>roleOwnershipMatches(x,"AE1","all")).map(x=>x.id),["P1","P2","P3"]);
  assert.equal(roleOwnershipMatches(rows[0],null,"mine"),false);
});

test("SM review flags and active filter count semantics remain explicit",()=>{
  assert.equal(isPendingSmReview(rows[0]),false);
  assert.equal(isPendingSmReview(rows[1]),true);
  assert.equal(isPendingSmReview(rows[2]),true);
  assert.equal(isFilterActive("status","open"),false);
  assert.equal(isFilterActive("status","won"),true);
  assert.equal(isFilterActive("status","all"),true);
  assert.equal(isFilterActive("owner","AE1"),true);
  assert.equal(isFilterActive("region",""),false);
});

test("All statuses remains a valid filter instead of reverting to default Open",()=>{
  assert.equal(normalizeFilterSelection("status","all"),"all");
  assert.equal(normalizeFilterSelection("stage","all"),"");
  assert.equal(normalizeFilterSelection("region","all"),"");
  assert.equal(normalizeFilterSelection("status","won"),"won");
});
