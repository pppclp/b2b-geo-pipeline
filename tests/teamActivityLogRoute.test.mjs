import test from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../server/core.js";

function fixture(){
 const access={scope:{AE:"own",SM:"region",Management:"all",Admin:"all"},demo_as_allowed_for:[],files:{
  "Org.xlsx":{sheets:{
   Users:{entity:"users",primary_key:"user_id",permissions:{read:["AE","SM","Management","Admin"]}},
   User_Region:{entity:"user_regions",primary_key:"user_region_id",permissions:{read:["AE","SM","Management","Admin"]}},
  }},
  "B2B_GEO_Pipeline_DB.xlsx":{sheets:{
   Pipelines:{entity:"opportunities",primary_key:"opportunity_id",scoped:true,permissions:{read:["AE","SM","Management","Admin"]}},
   Pipeline_Events:{entity:"opportunity_events",primary_key:"event_id",scoped:true,append_only:true,permissions:{read:["AE","SM","Management","Admin"]}},
  }}
 }};
 const data={
  "Org.xlsx/Users":[
    {user_id:"AE-N",display_name:"AE North",role:"AE",status:"Active"},
    {user_id:"AE-S",display_name:"AE South",role:"AE",status:"Active"},
    {user_id:"SM-N",display_name:"SM North",role:"SM",status:"Active"},
    {user_id:"M1",display_name:"Manager",role:"Management",status:"Active"},
    {user_id:"ADMIN",display_name:"Admin",role:"Admin",status:"Active"},
  ],
  "Org.xlsx/User_Region":[
    {user_region_id:"UR1",user_id:"AE-N",region_id:"N",active:"Yes"},
    {user_region_id:"UR2",user_id:"SM-N",region_id:"N",active:"Yes"},
    {user_region_id:"UR3",user_id:"AE-S",region_id:"S",active:"Yes"},
  ],
  "B2B_GEO_Pipeline_DB.xlsx/Pipelines":[
    {opportunity_id:"P1",region_id:"N",owner_user_id:"AE-N",current_handler_user_id:"AE-N",customer_name:"Synthetic North"},
    {opportunity_id:"P2",region_id:"S",owner_user_id:"AE-S",current_handler_user_id:"AE-S",customer_name:"Synthetic South"},
  ],
  "B2B_GEO_Pipeline_DB.xlsx/Pipeline_Events":[
    {event_id:"E1",opportunity_id:"P1",actor_user_id:"AE-N",event_type:"stage_change",event_at:"2026-10-28T01:00:00Z"},
    {event_id:"E2",opportunity_id:"P1",actor_user_id:"SM-N",event_type:"handler_change",event_at:"2026-10-28T02:00:00Z"},
    {event_id:"E3",opportunity_id:"P2",actor_user_id:"AE-S",event_type:"won",event_at:"2026-10-28T03:00:00Z"},
  ],
 };
 const store={table:(file,sheet)=>({rows:data[file+"/"+sheet]||[],headers:[]}),touch:()=>{throw Error("READ-ONLY: Activity Log must not write")}};
 return createCore({contract:{access,columns:{}},store,now:()=>new Date().toISOString(),uuid:()=>String(123)});
}
test("authenticated core route enforces AE 403, SM region and Management role scope",()=>{
 const core=fixture();
 const read=(userId,query={})=>core.handle({userId,method:"GET",path:"activity-log",query});
 assert.throws(()=>read("AE-N"),e=>e.status===403);
 assert.deepEqual(read("SM-N").items.map(e=>e.id),["E1"]);
 assert.deepEqual(read("M1").items.map(e=>e.id),["E3","E2","E1"]);
 assert.deepEqual(read("M1",{role:"sm"}).items.map(e=>e.id),["E2"]);
 assert.deepEqual(read("ADMIN").items.map(e=>e.id),["E3","E2","E1"]);
 assert.deepEqual(read("SM-N",{actor_id:"AE-S"}).items,[]);
 assert.throws(()=>core.handle({userId:"SM-N",method:"POST",path:"activity-log"}),e=>e.status===405);
 assert.throws(()=>read("UNKNOWN"),e=>e.status===401);
});
