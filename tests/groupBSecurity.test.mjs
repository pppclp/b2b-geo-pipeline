import test from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../server/core.js";
import { loadContract } from "../server/contract.js";
import { currentMonthKey, monthOf } from "../src/lib/pipeline.js";
import { monthOf as dashboardMonthOf, dashboardCohort } from "../src/lib/dashboardMetrics.js";

const contract = loadContract(new URL("../b2b_geo_pipeline.yaml", import.meta.url));
const ORG="B2B_GEO_User_Org_Master.xlsx";
const DB="B2B_GEO_Pipeline_DB.xlsx";
const CONFIG="B2B_GEO_Pipeline_Config.xlsx";

function fixture() {
  const seed={
    [ORG+"/Users"]:[
      {user_id:"AE1",employee_id:"1001",display_name:"AE 1",role:"AE",status:"Active"},
      {user_id:"AE2",employee_id:"1002",display_name:"AE 2",role:"AE",status:"Active"},
      {user_id:"SM1",employee_id:"2001",display_name:"SM 1",role:"SM",status:"Active"},
      {user_id:"M1",employee_id:"3001",display_name:"Manager",role:"Management",status:"Active"},
      {user_id:"ADMIN",employee_id:"4001",display_name:"Admin",role:"Admin",status:"Active"},
    ],
    [ORG+"/User_Region"]:[
      {user_region_id:"UR1",user_id:"AE1",region_id:"R1",active:"Yes"},
      {user_region_id:"UR2",user_id:"AE2",region_id:"R2",active:"Yes"},
      {user_region_id:"UR3",user_id:"SM1",region_id:"R1",active:"Yes"},
    ],
    [ORG+"/Regions"]:[{region_id:"R1",active:"Yes"},{region_id:"R2",active:"Yes"}],
    [CONFIG+"/Stages"]:[{stage_id:"S1",active:"Yes"}],
    [CONFIG+"/Lost_Reasons"]:[{reason_id:"LR1",active:"Yes",reason_name:"Price"}],
    [CONFIG + "/Product_Categories"]:[{category_id:"CAT",active:"Yes"}],
    [DB+"/Pipelines"]:[
      {opportunity_id:"P1",customer_name:"Acme",owner_user_id:"AE1",current_handler_user_id:"AE1",original_owner_user_id:"AE1",region_id:"R1",status:"Open",stage_id:"S1",product_category_id:"CAT",quantity:1,price_per_sub:100,pipeline_value:100,expected_close_month:"2026-11"},
      {opportunity_id:"P2",customer_name:"Beta",owner_user_id:"AE2",current_handler_user_id:"AE2",original_owner_user_id:"AE2",region_id:"R2",status:"Open",stage_id:"S1",product_category_id:"CAT",quantity:1,price_per_sub:200,pipeline_value:200,expected_close_month:"2026-11"},
    ],
  };
  const tabs={};let counter=0;
  const store={
    table(file,sheet) {
      const key=file+"/"+sheet;
      if(!tabs[key]) tabs[key]={headers:Object.keys(seed[key]?.[0]||{}),rows:seed[key]||[]};
      return tabs[key];
    },
    touch(){},
  };
  const core=createCore({contract,store,now:()=>"2026-10-18T10:00:00.000Z",uuid:()=>String(++counter)});
  let requestSequence=0;
  const call=(userId,method,path,body)=>{
    const actualBody = body && method==="PUT" && path.startsWith("entities/Opportunity/") &&
      body.expected_updated_at === undefined
      ? { ...body, expected_updated_at: String(store.table(DB,"Pipelines").rows.find((r)=>String(r.opportunity_id)===decodeURIComponent(path.slice("entities/Opportunity/".length)))?.updated_at || "") }
      : body;
    const withRequestId = method==="POST" && path==="entities/Opportunity" && actualBody &&
      !("client_request_id" in actualBody)
      ? { ...actualBody, client_request_id: "test_req_"+String(++requestSequence).padStart(12,"0") }
      : actualBody;
    return core.handle({userId,method,path,body:withRequestId});
  };
  return {call,rawCall:(userId,method,path,body)=>core.handle({userId,method,path,body}),row:()=>store.table(DB,"Pipelines").rows[0],allRows:()=>store.table(DB,"Pipelines").rows,events:()=>store.table(DB,"Pipeline_Events").rows,regions:()=>store.table(ORG,"User_Region").rows};
}
const denied=(status)=>(e)=>e.status===status;

test("B1: AE cannot Reopen/Archive; SM needs a nonblank Reopen reason",()=>{
  const x=fixture();
  x.call("AE1","PUT","entities/Opportunity/P1",{status:"won"});
  assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/P1",{status:"open",audit_remark:"retry"}),denied(403));
  assert.throws(()=>x.call("SM1","PUT","entities/Opportunity/P1",{status:"open"}),denied(400));
  assert.throws(()=>x.call("SM1","PUT","entities/Opportunity/P1",{status:"open",audit_remark:"  "}),denied(400));
  const out=x.call("SM1","PUT","entities/Opportunity/P1",{status:"open",audit_remark:"Customer reconsidered"});
  assert.equal(out.status,"open");
  assert.equal(x.row().won_at,"");
  assert.equal(x.row().won_by_user_id,"");
  assert.ok(x.events().some((event)=>event.event_type==="status_change" && event.remark==="Customer reconsidered"));
  assert.ok(x.events().some((event)=>event.event_type==="won"));
  assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/P1",{status:"archived"}),denied(403));
  x.call("SM1","PUT","entities/Opportunity/P1",{status:"archived"});
  assert.equal(String(x.row().status).toLowerCase(),"archived");
});

test("B1: Reopening a Lost Pipeline clears stale loss fields but keeps audit history",()=>{
  const x=fixture();
  x.call("AE1","PUT","entities/Opportunity/P1",{status:"lost",lost_reason_id:"LR1",lost_note:"Budget issue"});
  assert.ok(x.row().lost_at);
  assert.equal(x.row().lost_reason_id,"LR1");
  assert.ok(x.events().some(event=>event.event_type==="lost"));
  x.call("SM1","PUT","entities/Opportunity/P1",{status:"open",audit_remark:"Budget approved"});
  assert.equal(String(x.row().status).toLowerCase(),"open");
  assert.equal(x.row().lost_at,"");
  assert.equal(x.row().lost_by_user_id,"");
  assert.equal(x.row().lost_reason_id,"");
  assert.equal(x.row().lost_note,"");
  assert.ok(x.events().some(event=>event.event_type==="lost"));
  assert.ok(x.events().some(event=>event.event_type==="status_change"&&event.remark==="Budget approved"));
});

test("B1: AE cannot reprice or change expected close month on a closed Pipeline",()=>{
  const x=fixture();
  x.call("AE1","PUT","entities/Opportunity/P1",{status:"won"});
  for(const values of [{quantity:5},{price_per_sub:50},{oc:200},{contract_period:24},{contract_period_months:12},{expected_close_month:"2026-12"}]) {
    assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/P1",values),denied(409));
  }
  x.call("AE1","PUT","entities/Opportunity/P1",{remark:"A nonfinancial note"});
  assert.equal(x.row().remark,"A nonfinancial note");
});

test("B2: all ordinary user directories omit login employee_id except for Admin",()=>{
  const x=fixture();
  const team=x.call("AE1","GET","entities/TeamMember");
  assert.ok(team.length>0);
  assert.ok(team.every(member=>!("employee_id" in member)));
  const me=x.call("AE1","GET","entities/TeamMember/AE1");
  assert.equal(me.employee_id,undefined);
  const path="sheets/"+ORG+"/Users";
  const u=x.call("AE1","GET",path);
  assert.ok(u.headers.includes("user_id"));
  assert.ok(!u.headers.includes("employee_id"));
  assert.ok(u.rows.every(row=>!("employee_id" in row)));
  assert.throws(()=>x.call("AE1","GET","session/users"),denied(403));
  const adminMembers=x.call("ADMIN","GET","entities/TeamMember");
  assert.equal(adminMembers.find(m=>m.id==="AE1").employee_id,"1001");
  assert.ok(x.call("ADMIN","GET",path).headers.includes("employee_id"));
  assert.ok(x.call("ADMIN","GET","session/users").length>0);
});

test("B5: Management with no region sees zero Pipeline records; explicit regions grant access",()=>{
  const x=fixture();
  const list=()=>x.call("M1","GET","entities/Opportunity");
  assert.deepEqual(list(),[]);
  assert.equal(x.call("ADMIN","GET","entities/Opportunity").length,2);
  x.regions().push({user_region_id:"UR4",user_id:"M1",region_id:"R1",active:"Yes"});
  assert.deepEqual(list().map(o=>o.id),["P1"]);
  x.regions().push({user_region_id:"UR5",user_id:"M1",region_id:"R2",active:"Yes"});
  assert.deepEqual(list().map(o=>o.id),["P1","P2"]);
});

test("B6: frontend applies Bangkok business month to timestamps but keeps YYYY-MM date keys",()=>{
  const instant="2026-10-31T18:00:00.000Z";
  assert.equal(currentMonthKey(new Date(instant)),"2026-11");
  assert.equal(monthOf(instant),"2026-11");
  assert.equal(dashboardMonthOf(instant),"2026-11");
  assert.equal(monthOf("2026-11"),"2026-11");
  assert.equal(monthOf("2026-11-01"),"2026-11");
  assert.equal(monthOf("2026-10-31T23:00:00+07:00"),"2026-10");
  assert.equal(monthOf("not-a-date"),"");
  assert.equal(dashboardCohort([{created_date:instant,region_id:"R1"}],{createdMonth:"2026-11"}).length,1);
});

test("security: closed Pipelines reject changing Stage, Handler, owner and customer",()=>{
  const x=fixture();
  x.call("AE1","PUT","entities/Opportunity/P1",{status:"won"});
  const before=x.events().length;
  for(const changes of [{stage_id:"S1"},{current_handler_id:"SM1"},{customer_name:"Modified"},{owner_id:"AE2"}]){
    assert.throws(()=>x.call("ADMIN","PUT","entities/Opportunity/P1",changes),denied(409));
  }
  assert.equal(x.events().length,before);
  x.call("SM1","PUT","entities/Opportunity/P1",{status:"open",audit_remark:"Requalified"});
  x.call("SM1","PUT","entities/Opportunity/P1",{customer_name:"Legitimate edit"});
  assert.equal(x.row().customer_name,"Legitimate edit");
});

test("security: Management outside Region cannot become handler",()=>{
  const x=fixture();
  x.regions().push({user_region_id:"UR4",user_id:"M1",region_id:"R2",active:"Yes"});
  assert.throws(()=>x.call("ADMIN","PUT","entities/Opportunity/P1",{current_handler_id:"M1"}),denied(400));
});

test("security: API requires explicit revision and rejects stale writes",()=>{
  const x=fixture();
  assert.throws(()=>x.rawCall("AE1","PUT","entities/Opportunity/P1",{remark:"No revision"}),denied(428));
  const first=x.call("AE1","PUT","entities/Opportunity/P1",{remark:"First"});
  assert.throws(()=>x.rawCall("AE1","PUT","entities/Opportunity/P1",{
    remark:"Stale",expected_updated_at:"wrong"
  }),denied(409));
  assert.equal(x.row().remark,"First");
  assert.ok(first.updated_date);
});

test("security: text limits reject oversize fields",()=>{
  const x=fixture();
  for(const changes of [{customer_name:"X".repeat(201)},{product_details:"X".repeat(2001)},{contact_name:"X".repeat(121)}]){
    assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/P1",changes),denied(400));
  }
});

test("security: non-admin user directory and raw master are region-scoped",()=>{
  const x=fixture();
  const list=x.call("AE1","GET","entities/TeamMember");
  assert.ok(list.some((u)=>u.id==="AE1"));
  assert.ok(!list.some((u)=>u.id==="AE2"));
  assert.ok(!list.some((u)=>u.id==="M1"));
  assert.throws(()=>x.call("AE1","GET","entities/TeamMember/AE2"),denied(404));
  const users=x.call("AE1","GET","sheets/"+ORG+"/Users");
  assert.ok(!users.rows.some((u)=>u.user_id==="AE2"));
  const assignments=x.call("AE1","GET","sheets/"+ORG+"/User_Region");
  assert.ok(!assignments.rows.some((u)=>u.user_id==="AE2"));
  assert.ok(x.call("ADMIN","GET","entities/TeamMember").some((u)=>u.id==="AE2"));
});

test("security: keyed create retries return the same Pipeline without duplicate events",()=>{
  const x=fixture();
  const data={client_request_id:"req_abcdef0123456789",customer_name:"New Business",business_id:"123456",
    customer_type:"SME",sales_channel:"AE Self",contact_name:"Test",
    contact_phone:"0812345678",product_category_id:"CAT",expected_close_month:"2026-11",
    quantity:1,price_per_sub:100,owner_id:"AE1",region_id:"R1",stage_id:"S1"};
  const created=x.call("AE1","POST","entities/Opportunity",data);
  const count=x.allRows().length,events=x.events().length;
  const replay=x.call("AE1","POST","entities/Opportunity",data);
  assert.equal(replay.id,created.id);
  assert.equal(x.allRows().length,count);
  assert.equal(x.events().length,events);
  assert.throws(()=>x.call("AE1","POST","entities/Opportunity",{...data,customer_name:"Changed"}),denied(409));
});

test("A1: missing request key is rejected; keyed retries reuse the Pipeline",()=>{
  const x=fixture();
  const data={customer_name:"Keyed Lead",business_id:"111111",customer_type:"SME",
    sales_channel:"AE Self",contact_name:"Test",contact_phone:"0812345678",
    product_category_id:"CAT",expected_close_month:"2026-11",quantity:1,
    price_per_sub:100,owner_id:"AE1",region_id:"R1",stage_id:"S1"};
  const before=x.allRows().length;
  assert.throws(()=>x.rawCall("AE1","POST","entities/Opportunity",data),denied(400));
  assert.equal(x.allRows().length,before);
  const withId={...data,client_request_id:"test_req_abcdefgh1234"};
  const first=x.rawCall("AE1","POST","entities/Opportunity",withId);
  const again=x.rawCall("AE1","POST","entities/Opportunity",withId);
  assert.equal(again.id,first.id);
  assert.equal(x.allRows().length,before+1);
});
