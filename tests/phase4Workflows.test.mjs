import test from "node:test";
import assert from "node:assert/strict";
import {createCore} from "../server/core.js";

function harness(){
 const access={scope:{AE:"own",SM:"region",Management:"region",Admin:"all"},demo_as_allowed_for:[],files:{
  "Org.xlsx":{sheets:{
   Users:{entity:"users",primary_key:"user_id",permissions:{read:["AE","SM","Management","Admin"]}},
   User_Region:{entity:"user_regions",primary_key:"user_region_id",permissions:{read:["AE","SM","Management","Admin"]}}
  }},
  "Config.xlsx":{sheets:{
   Support_Types:{entity:"support_types",primary_key:"support_type_id",permissions:{read:["AE","SM","Management","Admin"]}},
   Working_With:{entity:"working_with_options",primary_key:"team_id",permissions:{read:["AE","SM","Management","Admin"]}}
  }},
  "B2B_GEO_Pipeline_DB.xlsx":{sheets:{
   Pipelines:{entity:"opportunities",primary_key:"opportunity_id",scoped:true,
     permissions:{read:["AE","SM","Management","Admin"],create:["AE","SM","Management","Admin"],update:["AE","SM","Management","Admin"]}},
   Pipeline_Events:{entity:"opportunity_events",primary_key:"event_id",scoped:true,append_only:true,
     permissions:{read:["AE","SM","Management","Admin"],create:[],update:[],delete:[]}},
   Handoff_Notifications:{entity:"handoff_notifications",primary_key:"notification_id",permissions:{read:[],create:[],update:[],delete:[]}},
   Support_Requests:{entity:"support_requests",primary_key:"request_id",permissions:{read:[],create:[],update:[],delete:[]}}
  }}
 }};
 const table={};let n=0;
 for(const [file,v] of Object.entries(access.files)) for(const sheet of Object.keys(v.sheets))
   table[file+"|"+sheet]={headers:[],rows:[]};
 table["Org.xlsx|Users"].rows=[
  {user_id:"AE1",display_name:"AE One",employee_id:"11",role:"AE",status:"Active"},
  {user_id:"AE2",display_name:"AE Two",employee_id:"22",role:"AE",status:"Active"},
  {user_id:"SM1",display_name:"SM One",employee_id:"33",role:"SM",status:"Active"},
  {user_id:"SM2",display_name:"SM Two",employee_id:"44",role:"SM",status:"Active"},
  {user_id:"M1",display_name:"Manager",employee_id:"55",role:"Management",status:"Active"},
  {user_id:"ADMIN",display_name:"Admin",employee_id:"66",role:"Admin",status:"Active"}
 ];
 table["Org.xlsx|User_Region"].rows=[
  ...["AE1","SM1","SM2","M1"].map((id,i)=>({user_region_id:"U"+i,user_id:id,region_id:"R1",active:"Yes"})),
  {user_region_id:"U5",user_id:"AE2",region_id:"R2",active:"Yes"}
 ];
 table["Config.xlsx|Support_Types"].rows=[{support_type_id:"SUP1",support_type_name:"Pricing",active:"Yes"}];
 table["Config.xlsx|Working_With"].rows=[{team_id:"TEAM1",team_name:"Presales",active:"Yes"},{team_id:"TEAM2",team_name:"Pricing",active:"Yes"}];
 const touched=[];
 const store={table:(f,s)=>table[f+"|"+s],touch:(f,s)=>touched.push(f+"|"+s)};
 const core=createCore({contract:{access,columns:{}},store,now:()=>"2026-10-19T05:30:00.000Z",uuid:()=>String(++n).padStart(4,"0")});
 const call=(userId,method,path,body)=>core.handle({userId,method,path,body});
 const create=()=>call("ADMIN","POST","entities/Opportunity",{
  customer_name:"Test Account",business_id:"123",customer_type:"SME",sales_channel:"AE Self",
  contact_name:"Tester",contact_phone:"0812345678",quantity:1,price_per_sub:100,
  product_category_id:"CAT1",expected_close_month:"2026-11",region_id:"R1",
  owner_id:"AE1",current_handler_id:"AE1",stage_id:"STG1",status:"open"
 });
 return {table,call,create,touched};
}
const db=(h,s)=>h.table["B2B_GEO_Pipeline_DB.xlsx|"+s].rows;

test("successful handoff creates recipient-only unread notification; repeat read idempotent",()=>{
 const h=harness(),op=h.create();
 assert.equal(h.call("SM1","GET","notifications").unread_count,0);
 const updated=h.call("ADMIN","PUT","entities/Opportunity/"+op.id,{current_handler_id:"SM1"});
 assert.equal(updated.current_handler_id,"SM1");
 const bell=h.call("SM1","GET","notifications");
 assert.equal(bell.unread_count,1);
 assert.equal(bell.items[0].opportunity_id,op.id);
 assert.equal(h.call("ADMIN","GET","notifications").unread_count,0);
 assert.throws(()=>h.call("AE1","POST","notifications/"+bell.items[0].id+"/read"),e=>e.status===404);
 h.call("SM1","POST","notifications/"+bell.items[0].id+"/read");
 h.call("SM1","POST","notifications/"+bell.items[0].id+"/read");
 assert.equal(h.call("SM1","GET","notifications").unread_count,0);
 assert.equal(db(h,"Handoff_Notifications").length,1);
});
test("a rejected handoff writes neither event nor notification",()=>{
 const h=harness(),op=h.create();
 const audit=db(h,"Pipeline_Events").length;
 assert.throws(()=>h.call("AE1","PUT","entities/Opportunity/"+op.id,{current_handler_id:"AE2"}),e=>e.status===400);
 assert.equal(db(h,"Handoff_Notifications").length,0);
 assert.equal(db(h,"Pipeline_Events").length,audit);
});
test("support request follows lifecycle, management scopes and resolution safeguards",()=>{
 const h=harness(),op=h.create();
 const request=h.call("AE1","POST","support-requests",{opportunity_id:op.id,request_type_id:"SUP1",note:"Please review pricing"});
 assert.equal(request.status,"Open");
 assert.equal(h.call("M1","GET","support-requests").length,1);
 assert.equal(h.call("AE2","GET","support-requests").length,0);
 assert.throws(()=>h.call("AE1","PATCH","support-requests/"+request.request_id,{status:"Resolved",response_note:"Done"}),e=>e.status===403);
 assert.throws(()=>h.call("M1","PATCH","support-requests/"+request.request_id,{status:"Resolved"}),e=>e.status===400);
 const progress=h.call("M1","PATCH","support-requests/"+request.request_id,{
  status:"In Progress",assigned_to_user_id:"M1",response_note:"Reviewing"
 });
 assert.equal(progress.status,"In Progress");
 const done=h.call("M1","PATCH","support-requests/"+request.request_id,{
  status:"Resolved",response_note:"Special pricing approved"
 });
 assert.equal(done.status,"Resolved");
 const row=db(h,"Pipelines")[0];
 assert.equal(row.support_needed,"No");
 assert.throws(()=>h.call("M1","PATCH","support-requests/"+request.request_id,{status:"Open"}),e=>e.status===409);
});
test("multi-team and people selection is validated and legacy first-team retained",()=>{
 const h=harness(),op=h.create();
 const updated=h.call("M1","PUT","entities/Opportunity/"+op.id,{
   working_with_team_ids:"TEAM1,TEAM2",working_with_user_ids:"SM1,AE1"
 });
 assert.equal(updated.working_with_team_ids,"TEAM1,TEAM2");
 assert.equal(updated.working_with_user_ids,"SM1,AE1");
 assert.equal(db(h,"Pipelines")[0].working_with_id,"TEAM1");
 assert.throws(()=>h.call("M1","PUT","entities/Opportunity/"+op.id,{
   working_with_team_ids:"TEAM1,NOPE"
 }),e=>e.status===400);
 assert.throws(()=>h.call("M1","PUT","entities/Opportunity/"+op.id,{
   working_with_user_ids:"AE2"
 }),e=>e.status===400);
});


test("AE creation alerts regional SM for missing Scenario / CCP+ without changing Handler",()=>{
 const h=harness();
 const op=h.call("AE1","POST","entities/Opportunity",{
  customer_name:"Regional New Account",business_id:"123456",customer_type:"SME",
  sales_channel:"AE Self",contact_name:"Contact",contact_phone:"0800000000",
  quantity:1,price_per_sub:100,product_category_id:"CAT1",
  expected_close_month:"2026-11",region_id:"R1",owner_id:"AE1",stage_id:"STG1",
 });
 assert.equal(op.owner_id,"AE1");
 assert.equal(op.current_handler_id,"AE1");
 assert.equal(h.call("AE1","GET","notifications").unread_count,0);
 const sm1=h.call("SM1","GET","notifications");
 const sm2=h.call("SM2","GET","notifications");
 assert.equal(sm1.unread_count,1);
 assert.equal(sm2.unread_count,1);
 assert.equal(sm1.items[0].type,"sm_input_needed");
 assert.equal(sm1.items[0].needs_sm_input,true);
 assert.equal(sm1.items[0].customer_name,"Regional New Account");
 assert.equal(h.call("M1","GET","notifications").unread_count,0);
 assert.equal(h.call("AE2","GET","notifications").unread_count,0);
 assert.equal(db(h,"Handoff_Notifications").length,2);
 h.call("SM1","POST","notifications/"+sm1.items[0].id+"/read");
 assert.equal(h.call("SM1","GET","notifications").unread_count,0);
 // Reading a notification does not complete the required SM fields.
 assert.equal(h.call("SM1","GET","notifications").items[0].needs_sm_input,true);
 h.call("SM1","PUT","entities/Opportunity/"+op.id,{
  scenario_id:"SCN1",ccp_check_result:"not_in_base",
 });
 assert.equal(h.call("SM1","GET","notifications").items[0].needs_sm_input,false);
 assert.equal(h.call("AE1","GET","entities/Opportunity/"+op.id).current_handler_id,"AE1");
});

test("SM creation can set Scenario and CCP+ immediately and alerts the AE owner once",()=>{
 const h=harness();
 const op=h.call("SM1","POST","entities/Opportunity",{
  customer_name:"SM Account",business_id:"123456",customer_type:"SME",
  sales_channel:"AE Self",contact_name:"Contact",contact_phone:"0800000000",
  quantity:1,price_per_sub:100,product_category_id:"CAT1",
  expected_close_month:"2026-11",region_id:"R1",owner_id:"AE1",stage_id:"STG1",
  scenario_id:"SCN1",ccp_check_result:"enterprise_base",
 });
 assert.equal(op.scenario_id,"SCN1");
 assert.equal(op.ccp_check_result,"enterprise_base");
 assert.equal(op.owner_id,"AE1");
 assert.equal(op.current_handler_id,"AE1");
 const ae=h.call("AE1","GET","notifications");
 assert.equal(ae.unread_count,1);
 assert.equal(ae.items[0].type,"pipeline_assigned");
 assert.equal(h.call("SM1","GET","notifications").unread_count,0);
 assert.equal(h.call("SM2","GET","notifications").unread_count,0);
});

test("Management creation alerts AE and regional SM but cannot override SM-only fields",()=>{
 const h=harness();
 const fields={
  customer_name:"Manager Account",business_id:"123456",customer_type:"SME",
  sales_channel:"AE Self",contact_name:"Contact",contact_phone:"0800000000",
  quantity:1,price_per_sub:100,product_category_id:"CAT1",
  expected_close_month:"2026-11",region_id:"R1",owner_id:"AE1",stage_id:"STG1",
 };
 assert.throws(()=>h.call("M1","POST","entities/Opportunity",{
  ...fields,scenario_id:"SCN1"
 }),e=>e.status===403);
 const op=h.call("M1","POST","entities/Opportunity",fields);
 assert.equal(op.current_handler_id,"AE1");
 assert.equal(h.call("AE1","GET","notifications").items[0].type,"pipeline_assigned");
 assert.equal(h.call("SM1","GET","notifications").items[0].type,"sm_input_needed");
 assert.equal(h.call("SM2","GET","notifications").items[0].type,"sm_input_needed");
 assert.throws(()=>h.call("M1","PUT","entities/Opportunity/"+op.id,{
  scenario_id:"SCN1"
 }),e=>e.status===403);
 assert.throws(()=>h.call("AE1","PUT","entities/Opportunity/"+op.id,{
  ccp_check_result:"not_in_base"
 }),e=>e.status===403);
 // General region-authorized Management edits are still allowed.
 assert.equal(h.call("M1","PUT","entities/Opportunity/"+op.id,{
  remark:"Shared customer update"
 }).remark,"Shared customer update");
});
