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
  GeoCoreLib:{createCore:()=>({captureScheduledSnapshot:(period)=>{
    events.push(["capture",{snapshot_period:period,actor:"SYSTEM_MONTH_END"}]);return {captured:1};
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
 assert.equal(call.actor,"SYSTEM_MONTH_END");
 assert.equal(call.snapshot_period,"2026-10");
});
test("legacy support backfill is disabled and historical records remain untouched",()=>{
 const v=gasMock();
 assert.throws(()=>v.context.backfillGeoPhase4SupportFlags(),/Retired/);
 assert.equal(v.support.rows.length,0);
 assert.equal(v.pipelines.length,2);
 assert.equal(v.events.length,0);
});
test("phase4 schema preparation and snapshot still require explicit approval",()=>{
 const v=gasMock({approved:false});
 assert.throws(()=>v.context.prepareGeoPhase4Sheets(),/APPROVED/);
 assert.throws(()=>v.context.runGeoMonthEndSnapshot(),/not approved/);
 assert.throws(()=>v.context.backfillGeoPhase4SupportFlags(),/Retired/);
});

test("Phase 2/4 required Pipeline columns exist in the YAML contract",()=>{
 const columns=contract.columns.opportunities;
 for(const field of ["import_batch_id","import_row_number","import_row_signature",
   "working_with_team_ids","working_with_user_ids"]){
   assert.ok(columns.includes(field),field+" must be in canonical Pipelines schema");
 }
});

test("Phase 4 preparation appends only missing Pipeline headers and is idempotent",()=>{
 const context={
   console:{log(){},warn(){},error(){}},
   PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==="GEO_PHASE4_SCHEMA_APPROVED"?"YES":k==="GEO_APPROVED_PIPELINE_DB_ID"?"TEST_APPROVED_WORKBOOK_ID":null})},
   LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
   GEO_CONTRACT:{columns:contract.columns}
 };
 const oldHeaders=["opportunity_id","business_id","region_id","owner_user_id",
   "current_handler_user_id","status"];
 const data=[["OPP1","123","R1","U1","U1","Open"]];
 const sheetMap=new Map();
 const writes=[];
 function sheet(name,headers,rows=[]){
   let cols=headers.slice();
   return {
     getName:()=>name,getLastRow:()=>rows.length+1,
     getLastColumn:()=>cols.length,getMaxColumns:()=>80,
     insertColumnAfter:()=>{throw Error("unexpected resize")},
     getRange:(row,col,nRows,nCols)=>({
       getDisplayValues:()=>[cols.slice(col-1,col-1+nCols)],
       setNumberFormat(){return this},
       setValue(value){
         if(row!==1)throw Error("existing data row changed");
         cols[col-1]=value;writes.push({sheet:name,row,col,value});return this;
       },
       setValues(values){
         if(row!==1)throw Error("existing data row changed");
         for(let i=0;i<values[0].length;i++)cols[col-1+i]=values[0][i];
         writes.push({sheet:name,row,col,values});return this;
       }
     }),
     headers:()=>cols,rows:()=>rows
   };
 }
 const pipeline=sheet("Pipelines",oldHeaders,data);
 sheetMap.set("Pipelines",pipeline);
 const book={
   getName:()=> "B2B_GEO_Pipeline_DB",
   getSheetByName:name=>sheetMap.get(name)||null,
   getId:()=> "TEST_APPROVED_WORKBOOK_ID",
   insertSheet:name=>{const obj=sheet(name,[]);sheetMap.set(name,obj);return obj;}
 };
 context.SpreadsheetApp={openById:()=>book,flush(){}};
 runInNewContext(source,context);
 context.sheetIdFor_=()=>book.getId();
 const first=context.prepareGeoPhase4Sheets();
 assert.equal(first.ok,true);
 assert.equal(first.appendedPipelineHeaders.length,5);
 assert.equal(pipeline.headers().length,oldHeaders.length+5);
 assert.deepEqual(data,[["OPP1","123","R1","U1","U1","Open"]]);
 const second=context.prepareGeoPhase4Sheets();
 assert.equal(second.appendedPipelineHeaders.length,0);
 assert.equal(sheetMap.size,3);
 assert.ok(writes.every(w=>w.row===1));
});
