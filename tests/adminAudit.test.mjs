import test from "node:test";
import assert from "node:assert/strict";
import { createOutputs, ADMIN_AUDIT_COLUMNS } from "../server/outputs.js";
import { loadContract } from "../server/contract.js";

const DB="B2B_GEO_Pipeline_DB.xlsx";
const SHEET="Admin_Audit";
function mock() {
  const contract=loadContract(new URL("../b2b_geo_pipeline.yaml", import.meta.url));
  const table={headers:[...ADMIN_AUDIT_COLUMNS],rows:[]};
  const dirty=[];
  const opened=[];
  let seq=0;
  const store={
    table(file,sheet) {
      opened.push(file+"/"+sheet);
      if(file===DB && sheet===SHEET) return table;
      throw new Error("Unexpected export workbook access: "+file+"/"+sheet);
    },
    touch(file,sheet) { dirty.push(file+"/"+sheet); },
  };
  const outputs=createOutputs({
    contract,store,
    now:()=>"2026-10-18T09:00:00.000Z",
    uuid:()=>String(++seq),
  });
  const actor={id:"ADMIN",real:{id:"ADMIN",name:"Admin",role:"admin"}};
  return {outputs,table,dirty,opened,actor};
}
test("Production access contract no longer binds mirror export workbooks",()=>{
 const c=loadContract(new URL("../b2b_geo_pipeline.yaml", import.meta.url));
 assert.equal(c.access.files["B2B_GEO_Current_Pipeline_Export_Template.xlsx"],undefined);
 assert.equal(c.access.files["B2B_GEO_Change_Log_Export_Template.xlsx"],undefined);
 assert.equal(c.access.files["B2B_GEO_Month_End_Export_Template.xlsx"],undefined);
 assert.deepEqual(c.access.files[DB].sheets[SHEET].permissions.read,["Admin"]);
 assert.deepEqual(c.access.files[DB].sheets[SHEET].permissions.create,[]);
});
test("Admin edits are audited field by field in canonical DB, never mirrored",()=>{
 const t=mock();
 const events=t.outputs.logMaster("UPDATED",
   {file:"B2B_GEO_Pipeline_Config.xlsx",sheet:"Stages",primary_key:"stage_id"},
   "STG001",{stage_id:"STG001",stage_name:"Qualify",sla_days:4},
   {stage_id:"STG001",stage_name:"Qualify",sla_days:5},t.actor);
 assert.equal(events.length,1);
 assert.deepEqual(t.opened,[DB+"/"+SHEET]);
 assert.deepEqual(t.dirty,[DB+"/"+SHEET]);
 assert.equal(events[0].actor_user_id,"ADMIN");
 assert.equal(events[0].actor_role,"admin");
 assert.equal(events[0].field_name,"sla_days");
 assert.equal(events[0].previous_value,"4");
 assert.equal(events[0].new_value,"5");
 assert.equal(events[0].source_record_id,"STG001");
 assert.equal(t.outputs.logMaster("UPDATED",{file:"Config.xlsx",sheet:"Stages",primary_key:"stage_id"},"STG001",{name:"Same"},{name:"Same"},t.actor).length,0);
});
test("Master create and delete snapshots retain full state and have unique audit IDs",()=>{
 const t=mock(),b={file:"Org.xlsx",sheet:"Regions",primary_key:"region_id"};
 const row={region_id:"R1",region_name:"East",active:"Yes"};
 const created=t.outputs.logMaster("CREATED",b,"R1",null,row,t.actor);
 const removed=t.outputs.logMaster("DELETED",b,"R1",row,null,t.actor);
 assert.deepEqual(JSON.parse(created[0].new_value),row);
 assert.deepEqual(JSON.parse(removed[0].previous_value),row);
 assert.notEqual(created[0].audit_id,removed[0].audit_id);
});
test("Audit is fail-closed when backend contract is missing Admin_Audit",()=>{
 const contract={access:{files:{[DB]:{sheets:{}}}}};
 const outputs=createOutputs({contract,store:{table(){throw new Error("should not read")}},now:()=>"now",uuid:()=>"X"});
 assert.throws(()=>outputs.logMaster("UPDATED",{file:"Org.xlsx",sheet:"Users",primary_key:"user_id"},"U1",{a:1},{a:2},{real:{id:"Admin"}}),/not configured/);
});
