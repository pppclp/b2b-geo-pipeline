import test from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../server/core.js";

function makeBackend() {
  const access={scope:{AE:"own",SM:"region",Management:"region",Admin:"all"},demo_as_allowed_for:["Admin"],files:{
    "Users.xlsx":{sheets:{
      Users:{entity:"users",primary_key:"user_id",permissions:{read:["AE","Management","Admin"]}},
      User_Region:{entity:"user_regions",primary_key:"user_region_id",permissions:{read:["AE","Management","Admin"]}},
    }},
    "Config.xlsx":{sheets:{
      Stages:{entity:"stages",primary_key:"stage_id",permissions:{read:["AE","Management","Admin"],create:["Admin"],update:["Admin"]}},
      Aging_Settings:{entity:"pipeline_settings",primary_key:"setting_id",permissions:{read:["AE","Management","Admin"],update:["Admin"]}},
    }},
    "B2B_GEO_Pipeline_DB.xlsx":{sheets:{
      Pipelines:{entity:"opportunities",primary_key:"opportunity_id",scoped:true,permissions:{
        read:["AE","Management","Admin"],export:["AE","Management","Admin"]}},
      Admin_Audit:{entity:"admin_audit",primary_key:"audit_id",append_only:true,permissions:{
        read:["Admin"],create:[],update:[],delete:[]}},
    }},
  }};
  const data={
    "Users.xlsx|Users":{headers:["user_id","status","role"],rows:[
      {user_id:"AE1",role:"AE",status:"Active"},
      {user_id:"AE2",role:"AE",status:"Active"},
      {user_id:"M1",role:"Management",status:"Active"},
      {user_id:"ADMIN",role:"Admin",status:"Active"},
    ]},
    "Users.xlsx|User_Region":{headers:["user_region_id","user_id","region_id"],rows:[
      {user_region_id:"UR1",user_id:"AE1",region_id:"R1",active:"Yes"},
      {user_region_id:"UR2",user_id:"AE2",region_id:"R2",active:"Yes"},
    ]},
    "Config.xlsx|Stages":{headers:["stage_id","stage_name"],rows:[{stage_id:"S1",stage_name:"Qualify",sort_order:1}]},
    "Config.xlsx|Aging_Settings":{headers:["setting_id","threshold_days"],rows:[{setting_id:"A1",threshold_days:14,active:"Yes"}]},
    "B2B_GEO_Pipeline_DB.xlsx|Admin_Audit":{headers:[],rows:[]},
    "B2B_GEO_Pipeline_DB.xlsx|Pipelines":{headers:["opportunity_id","region_id","owner_user_id"],rows:[
      {opportunity_id:"O1",region_id:"R1",owner_user_id:"AE1",current_handler_user_id:"AE1",status:"Open"},
      {opportunity_id:"O2",region_id:"R2",owner_user_id:"AE2",current_handler_user_id:"AE2",status:"Open"},
    ]},
  };
  const touched=[];
  const store={table:(f,s)=>data[f+"|"+s],touch:(f,s)=>touched.push(f+"|"+s)};
  const core=createCore({contract:{access,columns:{stages:["stage_id","stage_name","sla_days"]}},store,now:()=> "2026-10-18T08:00:00Z",uuid:()=> "123456"});
  const call=(actor,method,path,body)=>core.handle({userId:actor,method,path,body});
  return {call,data,touched};
}

test("Backend export permission also applies the authenticated row scope",()=>{
  const {call}=makeBackend();
  assert.deepEqual(call("AE1","GET","exports/pipelines").map(o=>o.id),["O1"]);
  assert.deepEqual(call("AE2","GET","exports/pipelines").map(o=>o.id),["O2"]);
  assert.deepEqual(call("M1","GET","exports/pipelines").map(o=>o.id),["O1","O2"]);
  assert.throws(()=>call("missing","GET","exports/pipelines"),e=>e.status===401);
});
test("Admin manages Stage SLA without a new sheet",()=>{
  const x=makeBackend();
  const result=x.call("ADMIN","PUT","entities/Stage/S1",{sla_days:5});
  assert.equal(result.sla_days,5);
  assert.equal(x.data["Config.xlsx|Stages"].rows[0].sla_days,5);
  assert.equal(x.data["B2B_GEO_Pipeline_DB.xlsx|Admin_Audit"].rows[0].event_type,"MASTER_UPDATED");
  assert.ok(x.touched.includes("B2B_GEO_Pipeline_DB.xlsx|Admin_Audit"));
  assert.throws(()=>x.call("ADMIN","PUT","entities/Stage/S1",{sla_days:0}),e=>e.status===400);
  assert.throws(()=>x.call("AE1","PUT","entities/Stage/S1",{sla_days:2}),e=>e.status===403);
});
test("Internal SLA is independent and stored in existing Aging_Settings",()=>{
  const x=makeBackend();
  const result=x.call("ADMIN","PUT","entities/AppConfig/internal_task_sla_days",{value:"3"});
  assert.equal(result.value,"3");
  assert.equal(x.data["Config.xlsx|Aging_Settings"].rows[0].internal_task_sla_days,3);
  assert.equal(x.data["B2B_GEO_Pipeline_DB.xlsx|Admin_Audit"].rows[0].field_name,"internal_task_sla_days");
  assert.throws(()=>x.call("ADMIN","PUT","entities/AppConfig/internal_task_sla_days",{value:0}),e=>e.status===400);
  assert.throws(()=>x.call("AE1","PUT","entities/AppConfig/internal_task_sla_days",{value:4}),e=>e.status===403);
});
