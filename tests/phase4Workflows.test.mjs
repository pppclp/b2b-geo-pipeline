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
 const call=(userId,method,path,body)=>{
    const actualBody = body && method==="PUT" && path.startsWith("entities/Opportunity/") &&
      body.expected_updated_at === undefined
      ? { ...body, expected_updated_at: String(table["B2B_GEO_Pipeline_DB.xlsx|Pipelines"].rows.find((r)=>String(r.opportunity_id)===decodeURIComponent(path.slice("entities/Opportunity/".length)))?.updated_at || "") }
      : body;
    const keyedBody = method === "POST" && path === "entities/Opportunity"
      ? { ...actualBody, client_request_id: actualBody?.client_request_id || "phase4_req_" + String(++n).padStart(8,"0") }
      : actualBody;
    const revisionBody = method === "PATCH" && path.startsWith("support-requests/") &&
    keyedBody?.expected_updated_at === undefined
    ? {...keyedBody,expected_updated_at:table["B2B_GEO_Pipeline_DB.xlsx|Support_Requests"].rows
        .find(r=>r.request_id===path.split("/")[1])?.updated_at||""}
    : keyedBody;
  return core.handle({userId,method,path,body:revisionBody});
  };
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
 assert.equal(db(h,"Handoff_Notifications").filter(n=>n.type==="handoff").length,1);
 assert.equal(db(h,"Handoff_Notifications").filter(n=>n.type==="pipeline_assigned").length,1);
});
test("a rejected handoff writes neither event nor notification",()=>{
 const h=harness(),op=h.create();
 const audit=db(h,"Pipeline_Events").length;
 const notificationCount=db(h,"Handoff_Notifications").length;
 assert.throws(()=>h.call("AE1","PUT","entities/Opportunity/"+op.id,{current_handler_id:"AE2"}),e=>e.status===400);
 assert.equal(db(h,"Handoff_Notifications").length,notificationCount);
 assert.equal(db(h,"Handoff_Notifications").filter(n=>n.type==="handoff").length,0);
 assert.equal(db(h,"Pipeline_Events").length,audit);
});
test("multi-team and people selection is validated and legacy first-team retained",()=>{
 const h=harness(),op=h.create();
 const updated=h.call("M1","PUT","entities/Opportunity/"+op.id,{
   working_with_team_ids:"TEAM1,TEAM2",working_with_user_ids:"SM1,AE1"
 });
 assert.equal(updated.working_with_team_ids,"TEAM1,TEAM2");
 assert.equal(updated.working_with_user_ids,"SM1,AE1");
 assert.equal(db(h,"Pipelines")[0].working_with_id,"TEAM1");
 const collaborationLogs=db(h,"Pipeline_Events").filter((e) =>
   e.event_type==="working_with_change");
 assert.equal(collaborationLogs.length,2);
 assert.deepEqual(collaborationLogs.map((e) => e.field_name).sort(),
   ["working_with_people","working_with_teams"]);
 assert.equal(db(h,"Pipelines")[0].current_handler_user_id,"AE1");
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
 assert.deepEqual(Object.keys(sm1.items[0]).sort(),[
   "actor_name","created_at","customer_name","id","needs_sm_input",
   "opportunity_id","read_at","type",
 ].sort());
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

test("Needs Support toggle works for AE, SM, Management and Admin without creating tickets",()=>{
 const h=harness(),op=h.create(),id=op.id;
 const initialEvents=db(h,"Pipeline_Events").length;
 const turnOn=(user)=>h.call(user,"PUT","entities/Opportunity/"+id,{
   support_needed:true,support_type:"Pricing",support_note:"Help with pricing"
 });
 const turnOff=(user)=>h.call(user,"PUT","entities/Opportunity/"+id,{support_needed:false});
 const on=turnOn("AE1");
 assert.equal(on.support_needed,true);
 assert.equal(db(h,"Pipelines")[0].support_type_id,"SUP1");
 assert.equal(db(h,"Pipelines")[0].support_note,"Help with pricing");
 assert.equal(turnOff("SM1").support_needed,false);
 assert.equal(db(h,"Pipelines")[0].support_type_id,"");
 assert.equal(db(h,"Pipelines")[0].support_note,"");
 turnOn("M1");turnOff("ADMIN");
 assert.equal(db(h,"Support_Requests").length,0);
 assert.equal(db(h,"Pipelines")[0].support_needed,"No");
 const events=db(h,"Pipeline_Events").slice(initialEvents);
 assert.ok(events.some(x=>x.field_name==="support_needed"));
 assert.ok(events.some(x=>x.field_name==="support_type_id"));
});

test("Creating with Needs Support requires Type/Note but does not create a ticket",()=>{
 const h=harness();
 const payload={
   customer_name:"Flagged account",business_id:"989",customer_type:"SME",
   sales_channel:"AE Self",contact_name:"Contact",contact_phone:"0800000000",
   quantity:1,price_per_sub:100,product_category_id:"CAT1",
   expected_close_month:"2026-11",region_id:"R1",owner_id:"AE1",
   stage_id:"STG1",support_needed:true,client_request_id:"support_test_create_001"
 };
 assert.throws(()=>h.call("AE1","POST","entities/Opportunity",payload),e=>e.status===400);
 const op=h.call("AE1","POST","entities/Opportunity",{
   ...payload,support_type:"Pricing",support_note:"Please review"
 });
 assert.equal(op.support_needed,true);
 assert.equal(db(h,"Support_Requests").length,0);
 assert.equal(db(h,"Pipelines").find(x=>x.opportunity_id===op.id).support_note,"Please review");
});

test("Toggle rejects invalid inputs and enforces AE scope; old ticket API is retired",()=>{
 const h=harness(),op=h.create(),id=op.id;
 assert.throws(()=>h.call("AE2","PUT","entities/Opportunity/"+id,{support_needed:true}),e=>e.status===403);
 assert.throws(()=>h.call("AE1","PUT","entities/Opportunity/"+id,{support_needed:true}),e=>e.status===400);
 assert.throws(()=>h.call("AE1","PUT","entities/Opportunity/"+id,{
   support_needed:true,support_type:"Pricing",support_note:""
 }),e=>e.status===400);
 h.call("AE1","PUT","entities/Opportunity/"+id,{support_needed:true,support_type:"Pricing",support_note:"Approval"});
 const auditBefore=db(h,"Pipeline_Events").length;
 assert.throws(()=>h.call("AE2","PUT","entities/Opportunity/"+id,{support_needed:false}),e=>e.status===403);
 assert.equal(db(h,"Pipeline_Events").length,auditBefore);
 const legacy={request_id:"SRQ-HIST",opportunity_id:id,status:"In Progress",assigned_to_user_id:"M1"};
 db(h,"Support_Requests").push(legacy);
 h.call("AE1","PUT","entities/Opportunity/"+id,{support_needed:false});
 assert.deepEqual(db(h,"Support_Requests"),[legacy]);
 assert.equal(db(h,"Pipelines")[0].support_needed,"No");
 for(const method of ["GET","POST","PATCH"])
   assert.throws(()=>h.call("M1",method,method==="PATCH"?"support-requests/SRQ-HIST":"support-requests",{}),e=>e.status===410);
});


test("UAT: team multi-select survives reload and preserves legacy Working With people",()=>{
 const h=harness(),op=h.create(),id=op.id;
 h.call("M1","PUT","entities/Opportunity/"+id,{working_with_user_ids:"SM1,AE1"});
 const previousPersonEvents=db(h,"Pipeline_Events").filter(e=>e.field_name==="working_with_people").length;
 const first=h.call("AE1","PUT","entities/Opportunity/"+id,{working_with_team_ids:"TEAM1,TEAM2"});
 assert.equal(first.working_with_team_ids,"TEAM1,TEAM2");
 assert.equal(first.working_with_user_ids,"SM1,AE1");
 assert.equal(first.working_with,"TEAM1");
 const afterReload=h.call("AE1","GET","entities/Opportunity/"+id);
 assert.equal(afterReload.working_with_team_ids,"TEAM1,TEAM2");
 assert.equal(afterReload.working_with_user_ids,"SM1,AE1");
 assert.equal(afterReload.working_with,"TEAM1");
 const second=h.call("SM1","PUT","entities/Opportunity/"+id,{working_with_team_ids:"TEAM2"});
 assert.equal(second.working_with_team_ids,"TEAM2");
 assert.equal(second.working_with_user_ids,"SM1,AE1");
 assert.equal(second.working_with,"TEAM2");
 const afterSecondReload=h.call("AE1","GET","entities/Opportunity/"+id);
 assert.equal(afterSecondReload.working_with_team_ids,"TEAM2");
 assert.equal(afterSecondReload.working_with_user_ids,"SM1,AE1");
 assert.equal(db(h,"Pipelines")[0].working_with_user_ids,"SM1,AE1");
 assert.equal(db(h,"Pipeline_Events").filter(e=>e.field_name==="working_with_people").length,previousPersonEvents);
 const teams=db(h,"Pipeline_Events").filter(e=>e.field_name==="working_with_teams");
 assert.equal(teams.length,2);
 assert.equal(teams[0].new_value,"TEAM1,TEAM2");
 assert.equal(teams[1].new_value,"TEAM2");
});

test("UAT: two browser snapshots cannot overwrite changed teams; stale save has no audit side effects",()=>{
 const h=harness(),op=h.create(),id=op.id;
 const originalRevision=op.updated_date; // two browser tabs opened on the same revision
 const first=h.call("SM1","PUT","entities/Opportunity/"+id,{
   working_with_team_ids:"TEAM1,TEAM2",expected_updated_at:originalRevision
 });
 assert.notEqual(first.updated_date,originalRevision,"revision must advance even within the same millisecond");
 const eventCount=db(h,"Pipeline_Events").length;
 const touchedCount=h.touched.length;
 assert.throws(()=>h.call("M1","PUT","entities/Opportunity/"+id,{
   working_with_team_ids:"TEAM2",expected_updated_at:originalRevision
 }),e=>e.status===409);
 assert.equal(db(h,"Pipeline_Events").length,eventCount);
 assert.equal(h.touched.length,touchedCount);
 assert.equal(h.call("M1","GET","entities/Opportunity/"+id).working_with_team_ids,"TEAM1,TEAM2");
 const refreshed=h.call("M1","GET","entities/Opportunity/"+id);
 const retried=h.call("M1","PUT","entities/Opportunity/"+id,{
   working_with_team_ids:"TEAM2",expected_updated_at:refreshed.updated_date
 });
 assert.equal(retried.working_with_team_ids,"TEAM2");
 assert.notEqual(retried.updated_date,first.updated_date);
 assert.equal(db(h,"Pipeline_Events").filter(e=>e.field_name==="working_with_teams").length,2);
});

test("UAT: Needs Support creates server-owned on/off history for all four roles, limited by scope",()=>{
 const h=harness(),r1=h.create(),id=r1.id;
 const r2=h.call("ADMIN","POST","entities/Opportunity",{
   customer_name:"Region 2 test",business_id:"22222",customer_type:"SME",sales_channel:"AE Self",
   contact_name:"Region 2",contact_phone:"0800000011",quantity:1,price_per_sub:100,
   product_category_id:"CAT1",expected_close_month:"2026-12",region_id:"R2",
   owner_id:"AE2",current_handler_id:"AE2",stage_id:"STG1"
 });
 const checks=[
   ["AE1",true],["SM1",false],["M1",true],["ADMIN",false]
 ];
 for (const [user,needed] of checks) {
   const updated=h.call(user,"PUT","entities/Opportunity/"+id,{
      support_needed:needed,...(needed?{support_type:"Pricing",support_note:"Help requested by "+user}:{})
   });
   assert.equal(updated.support_needed,needed);
   const flags=db(h,"Pipeline_Events").filter(e=>e.opportunity_id===id &&
     e.field_name==="support_needed");
   const event=flags.at(-1);
   assert.equal(event.event_type,needed?"support_on":"support_off");
   assert.equal(event.actor_user_id,user);
   assert.equal(event.actor_name,user==="ADMIN"?"Admin":user==="AE1"?"AE One":user==="SM1"?"SM One":"Manager");
   assert.ok(event.event_at);
   assert.equal(event.previous_value,needed?"No":"Yes");
   assert.equal(event.new_value,needed?"Yes":"No");
   assert.equal(db(h,"Support_Requests").length,0);
 }
 for (const user of ["AE1","SM1","M1"]) {
   const auditBefore=db(h,"Pipeline_Events").length;
   assert.throws(()=>h.call(user,"PUT","entities/Opportunity/"+r2.id,{
      support_needed:true,support_type:"Pricing",support_note:"Out-of-region"
   }),e=>e.status===403, user+" must not alter R2");
   assert.equal(db(h,"Pipeline_Events").length,auditBefore);
 }
 assert.throws(()=>h.call("AE2","PUT","entities/Opportunity/"+id,{
   support_needed:true,support_type:"Pricing",support_note:"Not my deal"
 }),e=>e.status===403);
 const r2TurnedOn=h.call("AE2","PUT","entities/Opportunity/"+r2.id,{
   support_needed:true,support_type:"Pricing",support_note:"AE2 request"
 });
 assert.equal(r2TurnedOn.support_needed,true);
 assert.equal(h.call("ADMIN","PUT","entities/Opportunity/"+r2.id,{support_needed:false}).support_needed,false);
 assert.equal(h.call("SM1","GET","entities/OpportunityHistory").some(e=>e.opportunity_id===r2.id),false);
 assert.equal(h.call("AE2","GET","entities/OpportunityHistory").some(e=>e.opportunity_id===id),false);
});
