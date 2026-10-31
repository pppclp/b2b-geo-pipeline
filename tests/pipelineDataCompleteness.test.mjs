import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {missingPipelineCoreFields,isPipelineCoreIncomplete} from "../src/lib/pipelineDataCompleteness.js";
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
