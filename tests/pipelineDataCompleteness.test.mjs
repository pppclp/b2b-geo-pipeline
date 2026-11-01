import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {missingPipelineCoreFields,isPipelineCoreIncomplete} from "../src/lib/pipelineDataCompleteness.js";
import {reviewQueueRows,reviewQueueCounts,reviewSignals} from "../src/lib/pipelineReviewQueue.js";
import {formatNetRc} from "../src/lib/netRc.js";
import {matchesPipelineFilters,quickViewCounts,switchPipelineView} from "../src/lib/pipelineListFilters.js";
import {advancedFilterCount,visibleActiveFilters} from "../src/lib/pipelineFilterUi.js";

const complete={
 id:"OPP-1",customer_name:"Synthetic customer",customer_type:"SME",
 sales_channel:"AE Self",region_id:"R1",owner_id:"AE1",
 product_category_id:"CAT1",stage_id:"STG001",expected_close_month:"2026-11",
 status:"open",current_handler_id:"AE1",business_id:"",
 contact_name:"",contact_phone:"",partner_name:"",quantity:null,price_per_sub:null,
 scenario_id:"",ccp_check_result:"",stage_entered_at:"",product_details:"",
};
const context={master:{WorkingWithOption:[]},maps:{stage:{}},config:{},taskEntries:[],viewerId:"AE1",viewerRole:"ae",nowMonth:"2026-11"};
test("optional and legacy blank data never triggers core incomplete status",()=>{
 assert.deepEqual(missingPipelineCoreFields(complete),[]);
 assert.equal(isPipelineCoreIncomplete(complete),false);
 assert.equal(isPipelineCoreIncomplete({...complete,business_id:"",contact_name:"",contact_phone:"",price_per_sub:null}),false);
});
test("required core field detection includes field names without inventing values",()=>{
 const row={...complete,customer_type:"",region_id:null,expected_close_month:"  "};
 assert.deepEqual(missingPipelineCoreFields(row).map(f=>f.key),["customer_type","region_id","expected_close_month"]);
 assert.deepEqual(missingPipelineCoreFields(row).map(f=>f.label),["ประเภทลูกค้า","Region","เดือนที่คาดว่าจะปิดงาน"]);
 assert.equal(isPipelineCoreIncomplete(row),true);
});
test("Inactive-but-present legacy Stage is not missing; closed Won is never reassigned",()=>{
 const legacy={...complete,stage_id:"STG003",status:"won",price_per_sub:null};
 assert.equal(isPipelineCoreIncomplete(legacy),false);
 assert.equal(legacy.stage_id,"STG003");
 assert.equal(legacy.status,"won");
});
test("Incomplete filter intersects existing status/region/owner and respects authorized inputs",()=>{
 const missing={...complete,id:"OPP-2",region_id:"R2",customer_type:""};
 assert.equal(matchesPipelineFilters(missing,{status:"open",incomplete:"1"},context),true);
 assert.equal(matchesPipelineFilters(complete,{status:"open",incomplete:"1"},context),false);
 assert.equal(matchesPipelineFilters(missing,{status:"open",incomplete:"1",region:"R1"},context),false);
 assert.equal(matchesPipelineFilters(missing,{status:"open",incomplete:"1",region:"R2",owner:"AE1"},context),true);
 assert.equal(matchesPipelineFilters({...missing,status:"lost"},{status:"open",incomplete:"1"},context),false);
 const rows=[complete,missing];
 assert.equal(quickViewCounts(rows,{incomplete:"1",status:"open"},"AE1",context).all,1);
});
test("SM-specific Scenario/CCP+ filter retains its independent behavior and combines with Incomplete",()=>{
 const missingSm={...complete,scenario_id:"",ccp_check_result:""};
 const smOnly={...complete,scenario_id:"SC1",ccp_check_result:"not_in_base"};
 assert.equal(matchesPipelineFilters(missingSm,{sm_info:"missing"},context),true);
 assert.equal(matchesPipelineFilters(smOnly,{sm_info:"missing"},context),false);
 assert.equal(matchesPipelineFilters(missingSm,{incomplete:"1"},context),false);
 assert.equal(matchesPipelineFilters({...missingSm,owner_id:""},{sm_info:"missing",incomplete:"1"},context),true);
});
test("filter metadata has one compact advanced chip; toggles survive switching work views",()=>{
 assert.equal(advancedFilterCount({incomplete:"1",sm_info:"missing"}),2);
 assert.deepEqual(visibleActiveFilters({incomplete:"1"}),[["incomplete","1"]]);
 assert.equal(switchPipelineView({status:"open",incomplete:"1"},"due-this-month","AE1","ae").incomplete,"1");
});
test("Quick View has tiny missing data footer at absolute bottom, not a card",()=>{
 const quick=fs.readFileSync(new URL("../src/components/PipelineQuickView.jsx",import.meta.url),"utf8");
 const filter=fs.readFileSync(new URL("../src/components/FilterBar.jsx",import.meta.url),"utf8");
 const pipeline=fs.readFileSync(new URL("../src/pages/Pipeline.jsx",import.meta.url),"utf8");
 const dashboard=fs.readFileSync(new URL("../src/pages/Dashboard.jsx",import.meta.url),"utf8");
 assert.ok(quick.includes("missingPipelineCoreFields(op)"));
 assert.ok(quick.includes('<details className="border-t border-border/50 pt-2 text-[11px]'));
 assert.ok(quick.indexOf("ข้อมูลยังไม่ครบ")>quick.indexOf("<h3 className=\"text-sm font-semibold\">สรุปข้อมูล Pipeline</h3>"));
 assert.ok(quick.indexOf("ข้อมูลยังไม่ครบ")>quick.indexOf("</dl>"));
 assert.match(filter,/Data Quality/);
 assert.match(filter,/Incomplete Data/);
 assert.match(filter,/Missing SM Info/);
 assert.ok(!filter.includes('variant={filters.sm_info === "missing" ? "secondary"'));
 assert.match(pipeline,/params\.get\("incomplete"\)/);
 assert.doesNotMatch(dashboard,/Incomplete Data|missingPipelineCoreFields/);
});

test("blank and unknown historical Sales Channel are Incomplete Data; other records stay unchanged",()=>{
  for(const value of ["", null, "Other", "PTT : Thanyaburi, Nong Suea, Lam Luk Ka"]){
    const row={...complete,sales_channel:value};
    assert.deepEqual(missingPipelineCoreFields(row).map(f=>f.key),["sales_channel"]);
    assert.equal(isPipelineCoreIncomplete(row),true);
  }
  assert.equal(isPipelineCoreIncomplete({...complete,sales_channel:"RP"}),false);
  assert.equal(isPipelineCoreIncomplete({...complete,sales_channel:"Retail Partner"}),false);
  assert.equal(complete.sales_channel,"AE Self");
});

test("closed historical Pipeline with missing Sales Channel appears in read-only Review Queue",()=>{
  const won={...complete,id:"WON-1",status:"won",sales_channel:""};
  const lost={...complete,id:"LOST-1",status:"lost",sales_channel:"Other"};
  const closedClean={...complete,id:"WON-2",status:"won",sales_channel:"Premium Partner"};
  const rows=[won,lost,closedClean,complete];
  assert.deepEqual(reviewQueueRows(rows,{tab:"data"}).map(x=>x.id),["WON-1","LOST-1"]);
  assert.equal(reviewQueueRows(rows,{tab:"stage"}).some(x=>["WON-1","LOST-1"].includes(x.id)),false);
  assert.deepEqual(reviewSignals(won,[]).core.map(x=>x.key),["sales_channel"]);
  assert.equal(reviewQueueCounts(rows,[]).data,2);
  assert.equal(won.status,"won");
  assert.equal(lost.status,"lost");
});

test("open partner with blank AE Owner and SM handler is incomplete until AE assigned",()=>{
  const pending={...complete,id:"P-SM-1",owner_id:"",current_handler_id:"SM1",sales_channel:"Premium Partner"};
  assert.deepEqual(missingPipelineCoreFields(pending).map(f=>f.key),["owner_id"]);
  assert.deepEqual(reviewQueueRows([pending],{tab:"data"}).map(x=>x.id),["P-SM-1"]);
  const assigned={...pending,owner_id:"AE2",current_handler_id:"AE2"};
  assert.equal(isPipelineCoreIncomplete(assigned),false);
});

test("closed historical partner without AE stays in read-only Incomplete Data",()=>{
  const won={...complete,id:"WON-SM",status:"won",owner_id:"",current_handler_id:"SM1"};
  assert.deepEqual(reviewQueueRows([won],{tab:"data"}).map(x=>x.id),["WON-SM"]);
  assert.equal(reviewQueueRows([won],{tab:"stage"}).length,0);
  assert.equal(won.status,"won");
});

test("historical-only missing financial values enter Incomplete Data without fabricated zero",()=>{
  const unknown={...complete,id:"HIST-UNKNOWN",import_source_record_id:"DOC-1",
    quantity:null,price_per_sub:null,pipeline_value:null,
    import_source_rc:"",import_source_net_rc:""};
  const labels=missingPipelineCoreFields(unknown).map(x=>x.key);
  assert.deepEqual(labels,["quantity","import_source_rc","import_source_net_rc"]);
  assert.deepEqual(reviewQueueRows([unknown],{tab:"data"}).map(x=>x.id),["HIST-UNKNOWN"]);
  const approved={...unknown,quantity:1,import_source_rc:"200",import_source_net_rc:"200"};
  assert.equal(isPipelineCoreIncomplete(approved),false);
  assert.equal(isPipelineCoreIncomplete({...complete,quantity:null}),false);
  assert.equal(formatNetRc(""),"—");
  assert.equal(formatNetRc(null),"—");
  assert.equal(formatNetRc(0),"฿0.00");
});

test("closed historical records with missing source finance remain Won/Lost and are read-only review",()=>{
  const closed={...complete,id:"HIST-CLOSED",status:"won",import_source_record_id:"DOC-2",
    quantity:null,import_source_rc:"",import_source_net_rc:""};
  assert.deepEqual(reviewQueueRows([closed],{tab:"data"}).map(x=>x.id),["HIST-CLOSED"]);
  assert.equal(reviewQueueRows([closed],{tab:"stage"}).length,0);
  assert.equal(closed.status,"won");
});

test("historical Won with unknown original close date stays in read-only Incomplete Data",()=>{
  const historical={...complete,id:"WON-SOURCE",status:"won",
    import_source_record_id:"SRC-WON-1",stage_id:"STG003",won_at:""};
  assert.ok(missingPipelineCoreFields(historical).some(x=>x.key==="won_at"));
  assert.deepEqual(reviewQueueRows([historical],{tab:"data"}).map(x=>x.id),["WON-SOURCE"]);
  assert.equal(reviewQueueRows([historical],{tab:"stage"}).length,0);
  assert.equal(historical.status,"won");
});
