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
const PRODUCT="B2B_Product_Master.xlsx";

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
    [PRODUCT+"/Product_Categories"]:[{category_id:"CAT",active:"Yes"}],
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
  const call=(userId,method,path,body)=>core.handle({userId,method,path,body});
  return {call,row:()=>store.table(DB,"Pipelines").rows[0],events:()=>store.table(DB,"Pipeline_Events").rows,regions:()=>store.table(ORG,"User_Region").rows};
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

test("B1: AE cannot reprice or change expected close month on a closed Pipeline",()=>{
  const x=fixture();
  x.call("AE1","PUT","entities/Opportunity/P1",{status:"won"});
  for(const values of [{quantity:5},{price_per_sub:50},{oc:200},{contract_period:24},{contract_period_months:12},{expected_close_month:"2026-12"}]) {
    assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/P1",values),denied(403));
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
