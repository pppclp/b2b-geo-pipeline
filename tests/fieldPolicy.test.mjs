import test from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../server/core.js";
import { loadContract } from "../server/contract.js";
import { bangkokMonth, OPPORTUNITY_COLUMNS } from "../server/opportunityPolicy.js";

const contract = loadContract(new URL("../b2b_geo_pipeline.yaml", import.meta.url));
const ORG = "B2B_GEO_User_Org_Master.xlsx";
const CONFIG = "B2B_GEO_Pipeline_Config.xlsx";
const DB = "B2B_GEO_Pipeline_DB.xlsx";

function fixture(now = "2026-10-18T10:00:00.000Z") {
  const seed = {
    [ORG + "/Users"]: [
      { user_id:"AE1",employee_id:"1001",role:"AE",status:"Active",display_name:"AE 1" },
      { user_id:"AE2",employee_id:"1002",role:"AE",status:"Active",display_name:"AE 2" },
      { user_id:"SM1",employee_id:"2001",role:"SM",status:"Active",display_name:"SM 1" },
      { user_id:"SM2",employee_id:"2002",role:"SM",status:"Active",display_name:"SM 2" },
      { user_id:"ADMIN",employee_id:"3001",role:"Admin",status:"Active",display_name:"Admin" },
    ],
    [ORG + "/User_Region"]: [
      {user_region_id:"UR1",user_id:"AE1",region_id:"R1",active:"Yes"},
      {user_region_id:"UR2",user_id:"AE2",region_id:"R2",active:"Yes"},
      {user_region_id:"UR3",user_id:"SM1",region_id:"R1",active:"Yes"},
      {user_region_id:"UR4",user_id:"SM2",region_id:"R2",active:"Yes"},
    ],
    [ORG + "/Regions"]: [{region_id:"R1",active:"Yes"},{region_id:"R2",active:"Yes"}],
    [ORG + "/Territories"]: [{territory_id:"T1",region_id:"R1",active:"Yes"}],
    [CONFIG + "/Stages"]: [{stage_id:"S1",active:"Yes"},{stage_id:"S2",active:"Yes"},{stage_id:"OFF",active:"No"}],
    [CONFIG + "/Product_Categories"]: [{category_id:"CAT1",active:"Yes"},{category_id:"OFF",active:"No"}],
    [DB + "/Pipelines"]: [{
      opportunity_id:"OPP-1",owner_user_id:"AE1",current_handler_user_id:"AE1",
      original_owner_user_id:"AE1",region_id:"R1",status:"Open",stage_id:"S1",
      product_category_id:"CAT1",expected_close_month:"2026-11",
      stage_entered_at:"2026-09-01T00:00:00Z",handler_since:"2026-09-01T00:00:00Z",
      created_at:"2026-09-01T00:00:00Z",created_month:"2026-09",created_by_user_id:"AE1",
      quantity:1,price_per_sub:100,pipeline_value:100,
    }],
  };
  const tables={};
  const touched=[];
  const store={
    table(file,sheet) {
      const key=file+"/"+sheet;
      if (!tables[key]) tables[key]={headers:Object.keys((seed[key] || [])[0] || {}),rows:seed[key] || []};
      return tables[key];
    },
    touch(file,sheet) {touched.push(file+"/"+sheet);},
  };
  let num=0;
  const core=createCore({contract,store,now:()=>now,uuid:()=>String(++num)});
  const call=(userId,method,path,body)=>core.handle({userId,method,path,body});
  return {call,store,touched,row:()=>store.table(DB,"Pipelines").rows[0],events:()=>store.table(DB,"Pipeline_Events").rows};
}
const input=(changes={})=>({
  customer_name:"Shop",business_id:"123",customer_type:"SME",sales_channel:"AE Self",
  contact_name:"Jane",contact_phone:"0812345678",product_category_id:"CAT1",
  expected_close_month:"2026-11",owner_id:"AE1",region_id:"R1",stage_id:"S1",
  quantity:1,price_per_sub:100,...changes
});
const rejected=(status)=>(error)=>error.status===status;

test("Client cannot spoof attribution, system timers or arbitrary spreadsheet fields",()=>{
 const x=fixture();
 const initialEvents=x.events().length;
 x.call("AE1","PUT","entities/Opportunity/OPP-1",{
   created_date:"2010-01-01",created_by_user_id:"AE2",created_month:"2010-01",
   original_owner_id:"AE2",stage_entered_at:"2099-01-01",
   handler_since:"2099-01-01",won_at:"2020-01-01",won_by:"SM2",
   lost_at:"2020-01-01",archived_at:"2099-01-01",
   injected_column:"=IMPORTDATA(\"https://example.invalid\")",
   rc:99999,discount_pct:99,remark:"Safe edit",
 });
 const v=x.row();
 assert.equal(v.created_by_user_id,"AE1");
 assert.equal(v.original_owner_user_id,"AE1");
 assert.equal(v.created_month,"2026-09");
 assert.equal(v.stage_entered_at,"2026-09-01T00:00:00Z");
 assert.equal(v.handler_since,"2026-09-01T00:00:00Z");
 for (const bad of ["injected_column","rc","discount_pct","archived_at","won_at","won_by_user_id"]) assert.equal(bad in v,false);
 assert.equal(v.remark,"Safe edit");
 assert.ok(x.events().length>initialEvents);
 assert.equal(OPPORTUNITY_COLUMNS.has("injected_column"),false);
});

test("Stage and handler changes advance independent server-owned clocks",()=>{
 const x=fixture();
 x.call("AE1","PUT","entities/Opportunity/OPP-1",{stage_id:"S2",stage_entered_at:"2000-01-01"});
 assert.equal(x.row().stage_entered_at,"2026-10-18T10:00:00.000Z");
 assert.equal(x.row().handler_since,"2026-09-01T00:00:00Z");
 x.call("AE1","PUT","entities/Opportunity/OPP-1",{current_handler_id:"SM1",handler_since:"2000-01-01"});
 assert.equal(x.row().handler_since,"2026-10-18T10:00:00.000Z");
 assert.equal(x.row().stage_entered_at,"2026-10-18T10:00:00.000Z");
});

test("Create uses real actor, original owner and Bangkok business month",()=>{
 const x=fixture("2026-10-31T18:00:00.000Z");
 const v=x.call("AE1","POST","entities/Opportunity",input({created_month:"2001-01",original_owner_id:"SM1",stage_entered_at:"2001-01-01"}));
 const rows=x.store.table(DB,"Pipelines").rows;
 const added=rows.find(r=>r.opportunity_id===v.id);
 assert.equal(added.created_month,"2026-11");
 assert.equal(added.created_by_user_id,"AE1");
 assert.equal(added.original_owner_user_id,"AE1");
 assert.equal(added.stage_entered_at,"2026-10-31T18:00:00.000Z");
 assert.equal(bangkokMonth("2026-10-31T16:59:59Z"),"2026-10");
});

test("Cannot route customers to nonexistent/out-of-region or privileged handlers",()=>{
 const x=fixture();
 for(const id of ["AE2","SM2","GHOST"]) {
   assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/OPP-1",{current_handler_id:id}),rejected(400));
 }
 assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/OPP-1",{current_handler_id:"ADMIN"}),rejected(403));
 assert.throws(()=>x.call("SM1","PUT","entities/Opportunity/OPP-1",{owner_id:"SM1"}),rejected(400));
 x.call("AE1","PUT","entities/Opportunity/OPP-1",{current_handler_id:"SM1"});
 assert.equal(x.row().current_handler_user_id,"SM1");
 assert.throws(()=>x.call("AE2","GET","entities/Opportunity/OPP-1"),rejected(403));
});

test("Create requires assigned Region and valid active references",()=>{
 const x=fixture();
 for(const changed of [
   {region_id:"R2"},{region_id:"UNKNOWN"},{stage_id:"UNKNOWN"},
   {stage_id:"OFF"},{product_category_id:"OFF"},
   {expected_close_month:"2026-13"},{territory_id:"UNKNOWN"},
   {territory_id:"T1",region_id:"R2"},
 ]) assert.throws(()=>x.call("AE1","POST","entities/Opportunity",input(changed)),rejected(400));
 assert.throws(()=>x.call("AE1","POST","entities/Opportunity",input({owner_id:"SM1"})),rejected(403));
 const added=x.call("AE1","POST","entities/Opportunity",input({territory_id:"T1"}));
 assert.ok(added.id);
});

test("Cannot clear a required Region, Stage, Product Category or close month",()=>{
 const x=fixture();
 for(const change of [
  {region_id:""},{stage_id:""},{product_category_id:""},
  {expected_close_month:""},
 ]) assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/OPP-1",change),rejected(400));
});

test("Region changes are scoped; unchanged retired stage stays editable",()=>{
 const x=fixture();
 assert.throws(()=>x.call("SM1","PUT","entities/Opportunity/OPP-1",{region_id:"R2"}),(e)=>[400,403].includes(e.status));
 x.row().stage_id="LEGACY";
 x.call("AE1","PUT","entities/Opportunity/OPP-1",{remark:"legacy note"});
 assert.equal(x.row().remark,"legacy note");
});

test("Changing only a note does not rewrite an already stored Net RC",()=>{
 const x=fixture();
 x.row().pipeline_value=123; // historic value intentionally differs from formula
 x.call("AE1","PUT","entities/Opportunity/OPP-1",{remark:"Notes only"});
 assert.equal(x.row().pipeline_value,123);
 assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/OPP-1",{pipeline_value:9999}),rejected(400));
 x.call("AE1","PUT","entities/Opportunity/OPP-1",{quantity:2});
 assert.equal(x.row().pipeline_value,200);
});

test("A2: archiving stores server time, never a spoofed client archived_at", () => {
  const stamp="2026-10-18T10:00:00.000Z";
  const x=fixture(stamp);
  assert.equal(OPPORTUNITY_COLUMNS.has("archived_at"),true);
  // A new DB must declare this server field in its canonical YAML contract.
  assert.ok(contract.columns.opportunities.includes("archived_at"));
  x.call("AE1","PUT","entities/Opportunity/OPP-1",{archived_at:"2099-01-01",remark:"Before archive"});
  assert.equal(x.row().archived_at,undefined);
  x.call("SM1","PUT","entities/Opportunity/OPP-1",{status:"archived",archived_at:"2099-01-01"});
  assert.equal(x.row().archived_at,stamp);
  assert.ok(x.events().some((e)=>e.event_type==="archived"));
  x.call("AE1","PUT","entities/Opportunity/OPP-1",{remark:"Archived note",archived_at:"1900-01-01"});
  assert.equal(x.row().archived_at,stamp);
  assert.equal(x.row().remark,"Archived note");
});
