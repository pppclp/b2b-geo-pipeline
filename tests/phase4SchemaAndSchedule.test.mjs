import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {buildContract} from "../server/contract.js";

const yaml=readFileSync(new URL("../b2b_geo_pipeline.yaml",import.meta.url),"utf8");
const source=readFileSync(new URL("../apps-script/Main.js",import.meta.url),"utf8");
const contract=buildContract(yaml);

test("Phase 4 schema is app-owned and unavailable through generic Sheet APIs",()=>{
 const db=contract.access.files["B2B_GEO_Pipeline_DB.xlsx"].sheets;
 for(const [name,entity] of [["Handoff_Notifications","handoff_notifications"],["Support_Requests","support_requests"]]){
   assert.equal(db[name].entity,entity);
   for(const permissions of Object.values(db[name].permissions))assert.deepEqual(permissions,[]);
   assert.ok(contract.columns[entity].length>5);
 }
 assert.equal(db.Pipelines.entity,"opportunities");
});

function gasMock({date="2026-11-01",approved=true,existingSnapshot=false}={}){
 const props=new Map(approved?[["GEO_AUTO_SNAPSHOT_APPROVED","YES"],["GEO_PHASE4_SCHEMA_APPROVED","YES"]]:[]);
 const events=[], pipelines=[
  {opportunity_id:"OPP1",support_needed:"Yes",support_type_id:"SUP1",support_note:"Help",region_id:"R1"},
  {opportunity_id:"OPP2",support_needed:"No",region_id:"R1"},
 ];
 const support={headers:contract.columns.support_requests,rows:[]};
 const snaps={rows:existingSnapshot?[{snapshot_period:"2026-10"}]:[]};
 const context={
  console:{log(){},warn(){},error(){}},
  GEO_CONTRACT:{columns:contract.columns},
  PropertiesService:{getScriptProperties:()=>({
    getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)
  })},
  LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
  Utilities:{formatDate:()=>date,getUuid:()=>"uuid-"+(events.length+1)},
  GeoCoreLib:{createCore:()=>({handle:(req)=>{
    events.push(["capture",req]);return {captured:1};
  }})},
  ScriptApp:{getProjectTriggers:()=>[],newTrigger:()=>({
    timeBased:()=>({onMonthDay:()=>({atHour:()=>({inTimezone:()=>({
      create:()=>events.push(["installed"])
    })})})})
  })}
 };
 runInNewContext(source,context);
 context.SheetStore_=function(){
   this.table=(file,sheet)=>sheet==="Users"?{rows:[{user_id:"ADMIN",role:"Admin",status:"Active"}]}:
     sheet==="Pipelines"?{rows:pipelines}:sheet==="Support_Requests"?support:snaps;
   this.touch=(file,sheet)=>events.push(["touch",sheet]);
   this.flush=()=>events.push(["flush"]);
 };
 return {context,events,pipelines,support,snaps};
}

test("month-end trigger skips non-first dates and never replaces captured periods",()=>{
 const notFirst=gasMock({date:"2026-11-02"});
 assert.equal(notFirst.context.runGeoMonthEndSnapshot().skipped,"Not first day in Bangkok");
 assert.equal(notFirst.events.length,0);
 const present=gasMock({existingSnapshot:true});
 assert.equal(present.context.runGeoMonthEndSnapshot().skipped,"Snapshot already captured");
 assert.equal(present.events.length,0);
});
test("month-end trigger captures preceding Bangkok month exactly once",()=>{
 const v=gasMock();
 const result=v.context.runGeoMonthEndSnapshot();
 assert.equal(result.period,"2026-10");
 assert.equal(result.captured,1);
 const call=v.events.find(x=>x[0]==="capture")[1];
 assert.equal(call.path,"snapshots/capture");
 assert.equal(call.body.snapshot_period,"2026-10");
});
test("legacy support-flag backfill does not rewrite Pipelines and is safe to rerun",()=>{
 const v=gasMock();
 const once=v.context.backfillGeoPhase4SupportFlags();
 assert.equal(once.created,1);
 assert.equal(once.pipelineRows,2);
 assert.equal(v.support.rows[0].source,"migration");
 assert.equal(v.support.rows[0].requested_by_user_id,"");
 assert.equal(v.context.backfillGeoPhase4SupportFlags().created,0);
 assert.equal(v.support.rows.length,1);
 assert.ok(v.events.every(x=>x[0]!=="touch"||x[1]==="Support_Requests"));
});
test("phase4 migration and snapshot require explicit approval",()=>{
 const v=gasMock({approved:false});
 assert.throws(()=>v.context.prepareGeoPhase4Sheets(),/APPROVED/);
 assert.throws(()=>v.context.runGeoMonthEndSnapshot(),/not approved/);
 assert.throws(()=>v.context.backfillGeoPhase4SupportFlags(),/Approve Phase 4/);
});
