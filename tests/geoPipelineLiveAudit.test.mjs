import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../apps-script/Main.js", import.meta.url), "utf8");
const start=source.indexOf("function debugGeoPipelineDataIntegrity()");
const end=source.indexOf("// ---- Table store over Google Sheets",start);
assert.ok(start>0 && end>start, "Editor-only live audit function must exist");

test("read-only integrity audit catches missing revisions, bad refs and orphan events without sensitive IDs in logs",()=>{
 const x={
   "B2B_GEO_Pipeline_DB.xlsx|Pipelines":[
     {opportunity_id:"O1",owner_user_id:"U1",current_handler_user_id:"U1",stage_id:"S1",
      product_category_id:"C1",region_id:"R1",updated_at:"2026-10-27",stage_entered_at:"",expected_close_month:""},
     {opportunity_id:"O2",owner_user_id:"U1",current_handler_user_id:"MISSING",stage_id:"MISSING",
      product_category_id:"C1",region_id:"R1",updated_at:"",stage_entered_at:"",expected_close_month:"2026-11"},
   ],
   "B2B_GEO_Pipeline_DB.xlsx|Pipeline_Events":[
     {event_id:"E1",opportunity_id:"O1",event_type:"create"},
     {event_id:"E2",opportunity_id:"O1",event_type:"create"},
     {event_id:"E3",opportunity_id:"O-MISSING",event_type:"create"}
   ],
   "B2B_GEO_Pipeline_DB.xlsx|Snapshots":[
     {snapshot_id:"P1",snapshot_period:"2026-10",opportunity_id:"O1"},
     {snapshot_id:"P2",snapshot_period:"2026-10",opportunity_id:"O1"}
   ],
   "B2B_GEO_User_Org_Master.xlsx|Users":[{user_id:"U1"}],
   "B2B_GEO_User_Org_Master.xlsx|Regions":[{region_id:"R1"}],
   "B2B_GEO_Pipeline_Config.xlsx|Stages":[{stage_id:"S1"}],
   "B2B_GEO_Pipeline_Config.xlsx|Product_Categories":[{category_id:"C1"}],
 };
 const output=[];
 const context={
   LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
   SheetStore_:function(){this.table=(f,s)=>({rows:x[f+"|"+s]});},
   console:{log:(v)=>output.push(v)},
   Set, Object, String, JSON,
 };
 vm.createContext(context);
 vm.runInContext(source.slice(start,end),context);
 const result=context.debugGeoPipelineDataIntegrity();
 assert.equal(result.pipelines,2);
 assert.equal(result.missing_updated_at,1);
 assert.equal(result.missing_stage_entered_at,2);
 assert.equal(result.missing_expected_close_month,1);
 assert.equal(result.invalid_handler,1);
 assert.equal(result.invalid_stage,1);
 assert.equal(result.orphan_events,1);
 assert.equal(result.duplicate_create_events,1);
 assert.equal(result.no_create_event,1);
 assert.equal(result.snapshot_duplicate_period_pipeline,1);
 assert.ok(!output.join("").includes("O1"),"Do not log Pipeline IDs");
});

test("integrity diagnostics never enter the public unauthenticated request router",()=>{
 const route=source.slice(source.indexOf("function handle_(req)"),source.indexOf("function uatLogin_("));
 assert.doesNotMatch(route,/debugGeoPipelineDataIntegrity/);
 assert.match(source,/var GEO_RELEASE_TAG_ = "geo-write-audit-safe-20261027-r3"/);
 assert.match(source,/health: true/);
});
