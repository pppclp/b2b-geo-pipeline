import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../apps-script/Main.js",import.meta.url),"utf8");
const start=source.indexOf("function geoRevisionRepairPlan_(");
const end=source.indexOf("// ---- Table store over Google Sheets",start);
assert.ok(start>0&&end>start);
function fixture({extraUnsafe=false}={}){
 const p=[{opportunity_id:"OPP1",import_batch_id:"IMPORT_1",updated_at:"",
   stage_entered_at:"",handler_since:"",created_at:"2026-09-10"}];
 if(extraUnsafe)p.push({opportunity_id:"OPP2",import_batch_id:"",updated_at:""});
 const e=[{event_id:"E1",opportunity_id:"OPP1",event_type:"create",event_at:"2026-10-26T22:49:21.621Z"}];
 const audit=[];
 const sheets={"B2B_GEO_Pipeline_DB.xlsx|Pipelines":{rows:p},
   "B2B_GEO_Pipeline_DB.xlsx|Pipeline_Events":{rows:e},
   "B2B_GEO_Pipeline_DB.xlsx|Admin_Audit":{rows:audit}};
 const props=new Map([["GEO_ENVIRONMENT","UAT"]]);
 const touched=[],output=[];
 let commits=0;
 const ctx={
   LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
   PropertiesService:{getScriptProperties:()=>({
     getProperty:k=>props.get(k)||"",deleteProperty:k=>props.delete(k)
   })},
   SheetStore_:function(){
     this.table=(f,s)=>{const row=sheets[f+"|"+s];if(!row)throw Error("Missing "+s);return row};
     this.touch=(f,s)=>touched.push(s);
     this.flush=()=>{commits++};
   },
   Utilities:{getUuid:()=>"uuid-1"},
   console:{log:v=>output.push(v)},Set,Object,Date,JSON,Number,String
 };
 vm.createContext(ctx);
 vm.runInContext(source.slice(start,end),ctx);
 return {ctx,props,p,e,audit,touched,output,commits:()=>commits};
}
test("revision repair preview is read-only and a missing import date stays unknown",()=>{
 const x=fixture();
 const preview=x.ctx.debugGeoImportedRevisionRepair();
 assert.equal(preview.eligible,1);
 assert.equal(preview.unsafe_skipped,0);
 assert.equal(preview.missing_revisions,1);
 assert.equal(x.p[0].updated_at,"");
 assert.equal(x.commits(),0);
 assert.throws(()=>x.ctx.repairGeoImportedRevisionsApproved(),/explicit editor approval/);
 assert.equal(x.audit.length,0);
});
test("approved repair uses exact create event timestamp and appends audit atomically",()=>{
 const x=fixture();
 x.props.set("GEO_UAT_REVISION_REPAIR_APPROVED","YES");
 x.props.set("GEO_UAT_REVISION_REPAIR_EXPECTED_COUNT","1");
 const result=x.ctx.repairGeoImportedRevisionsApproved();
 assert.equal(result.repaired,1);
 assert.equal(x.p[0].updated_at,"2026-10-26T22:49:21.621Z");
 assert.equal(x.p[0].created_at,"2026-09-10");
 assert.equal(x.p[0].stage_entered_at,"");
 assert.equal(x.p[0].handler_since,"");
 assert.equal(x.audit.length,1);
 assert.equal(x.audit[0].source_sheet,"Pipelines");
 assert.equal(x.audit[0].field_name,"updated_at");
 assert.equal(x.audit[0].new_value,x.p[0].updated_at);
 assert.deepEqual(x.touched,["Pipelines","Admin_Audit"]);
 assert.equal(x.commits(),1);
 assert.equal(x.props.has("GEO_UAT_REVISION_REPAIR_APPROVED"),false);
});
test("unknown or changing rows are never silently repaired",()=>{
 const x=fixture({extraUnsafe:true});
 x.props.set("GEO_UAT_REVISION_REPAIR_APPROVED","YES");
 x.props.set("GEO_UAT_REVISION_REPAIR_EXPECTED_COUNT","1");
 assert.throws(()=>x.ctx.repairGeoImportedRevisionsApproved(),/unsafe missing revisions/);
 assert.equal(x.p[0].updated_at,"");
 assert.equal(x.audit.length,0);
 assert.equal(x.commits(),0);
});
test("import repair remains editor-only, never an unauthenticated API route",()=>{
 const code=source.slice(source.indexOf("function handle_(req)"),source.indexOf("function uatLogin_("));
 assert.doesNotMatch(code,/repairGeoImportedRevisionsApproved/);
});
