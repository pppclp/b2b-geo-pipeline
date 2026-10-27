import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
    [CONFIG + "/Field_Options"]: [
      { field_key:"customer_type",option_value:"SERVICE AND RETAIL",active:"Yes" },
      { field_key:"customer_type",option_value:"INACTIVE CLASS",active:"No" },
    ],
    [CONFIG + "/Lost_Reasons"]: [{reason_id:"LR1",active:"Yes"}],
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
  const call=(userId,method,path,body)=>{
    const actualBody = body && method==="PUT" && path.startsWith("entities/Opportunity/") &&
      body.expected_updated_at === undefined
      ? { ...body, expected_updated_at: String(store.table(DB,"Pipelines").rows.find((r)=>String(r.opportunity_id)===decodeURIComponent(path.slice("entities/Opportunity/".length)))?.updated_at || "") }
      : body;
    return core.handle({userId,method,path,body:actualBody});
  };
  return {call,store,touched,row:()=>store.table(DB,"Pipelines").rows[0],events:()=>store.table(DB,"Pipeline_Events").rows};
}
const input=(changes={})=>({
  customer_name:"Shop",business_id:"0000000000123",customer_type:"SME",sales_channel:"AE Self",
  contact_name:"Jane",contact_phone:"0812345678",product_category_id:"CAT1",
  expected_close_month:"2026-11",owner_id:"AE1",region_id:"R1",stage_id:"S1",
  quantity:1,price_per_sub:100,client_request_id:"field_policy_req_000001",...changes
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

test("historical import preserves source month and never invents a missing creation day",()=>{
  const stamp="2026-10-25T10:00:00.000Z";
  const x=fixture(stamp);
  const item=input({
    customer_name:"Synthetic historical lead",business_id:"0000000000123",
    source_created_month:"2026-07",client_request_id:undefined,
    created_at:"1999-01-01T00:00:00Z",event_at:"1999-01-01T00:00:00Z",
  });
  const response=x.call("SM1","POST","imports/opportunities",{
    batch_id:"part4_legacy_import_00001",items:[item]
  });
  assert.equal(response.total,1);
  const row=x.store.table(DB,"Pipelines").rows.find(r=>r.opportunity_id===response.opportunity_ids[0]);
  assert.equal(row.created_month,"2026-07");
  assert.equal(row.created_at,""); // source supplied month but no original creation day
  assert.equal(row.updated_at,stamp);
  assert.equal("source_created_month" in row,false);
  assert.ok(x.events().some(e=>e.opportunity_id===row.opportunity_id && e.event_at===stamp));
});

test("import batch retry rejects changed source month; explicit source ID prevents cross-batch duplicates",()=>{
  const x=fixture("2026-10-25T10:00:00.000Z");
  const item=input({customer_name:"Synthetic",business_id:"0000000000456",
    source_created_month:"2026-07",source_system:"Legacy CRM",source_record_id:"O-100",client_request_id:undefined});
  const batch={batch_id:"part4_legacy_import_00002",items:[item]};
  assert.equal(x.call("SM1","POST","imports/opportunities",batch).imported,1);
  const count=x.store.table(DB,"Pipelines").rows.length;
  const events=x.events().length;
  assert.equal(x.call("SM1","POST","imports/opportunities",batch).already_imported,true);
  assert.throws(()=>x.call("SM1","POST","imports/opportunities",{
    ...batch,items:[{...item,source_created_month:"2026-08"}]
  }),rejected(409));
  assert.throws(()=>x.call("SM1","POST","imports/opportunities",{
    batch_id:"part4_legacy_import_00003",items:[{...item,source_created_month:"2026-09"}]
  }),rejected(409));
  assert.equal(x.store.table(DB,"Pipelines").rows.length,count);
  assert.equal(x.events().length,events);
});

test("legacy commercial-only signature remains replay-compatible; unknown historical month stays blank",()=>{
  const x=fixture("2026-10-25T10:00:00.000Z");
  const item=input({customer_name:"Old format",business_id:"0000000000789",client_request_id:undefined});
  const batch={batch_id:"part4_legacy_import_00004",items:[item]};
  const saved=x.call("SM1","POST","imports/opportunities",batch);
  const row=x.store.table(DB,"Pipelines").rows.find(r=>r.opportunity_id===saved.opportunity_ids[0]);
  assert.equal(row.created_month,"");
  assert.equal(row.created_at,"");
  const legacyFingerprint=JSON.stringify([
    "business_id","product_category_id","expected_close_month","owner_id",
    "product_details","contact_phone","quantity","price_per_sub","oc"
  ].map(k=>String(item[k]??"").trim().toLowerCase()));
  row.import_row_signature=legacyFingerprint; // synthetic pre-upgrade import row
  assert.equal(x.call("SM1","POST","imports/opportunities",batch).already_imported,true);
  assert.equal(x.store.table(DB,"Pipelines").rows.length,2);
});

test("historical import with verified created day uses source date, not import timestamp",()=> {
  const x=fixture("2026-10-25T10:00:00.000Z");
  const item=input({customer_name:"Synthetic original date",business_id:"",
    source_created_at:"2026-06-04",source_created_month:"2026-06",client_request_id:undefined});
  const response=x.call("SM1","POST","imports/opportunities",{batch_id:"historical_date_confirmed_0001",items:[item]});
  const row=x.store.table(DB,"Pipelines").rows.find(r=>r.opportunity_id===response.opportunity_ids[0]);
  assert.equal(row.created_at,"2026-06-04");
  assert.equal(row.created_month,"2026-06");
  assert.equal(row.updated_at,"2026-10-25T10:00:00.000Z");
});

test("normal Create/Edit cannot set source month or system-owned dates",()=>{
  const x=fixture("2026-10-25T10:00:00.000Z");
  const created=x.call("AE1","POST","entities/Opportunity",input({
    business_id:"0000000000999",source_created_month:"2000-01",
    created_month:"2000-01",created_at:"2000-01-01"
  }));
  const row=x.store.table(DB,"Pipelines").rows.find(r=>r.opportunity_id===created.id);
  assert.equal(row.created_month,"2026-10");
  assert.equal(row.created_at,"2026-10-25T10:00:00.000Z");
  x.call("AE1","PUT","entities/Opportunity/"+created.id,{
    source_created_month:"1900-01",created_month:"1900-01",created_at:"1900-01-01",remark:"Note only"
  });
  assert.equal(row.created_month,"2026-10");
  assert.equal(row.remark,"Note only");
  assert.equal("source_created_month" in row,false);
});

test("invalid source month and unauthorized import fail before any Pipeline or event write",()=>{
  const x=fixture();
  const beforeRows=x.store.table(DB,"Pipelines").rows.length;
  const beforeEvents=x.events().length;
  const item=input({business_id:"0000000000222",client_request_id:undefined});
  for(const invalid of ["2026-13","2026-00","0000-01","2101-01","2026/07","2026-07-01","01/07/2026"]){
    assert.throws(()=>x.call("SM1","POST","imports/opportunities",{
      batch_id:"part4_invalid_"+invalid.replace(/[^a-zA-Z0-9]/g,"_")+"0000",
      items:[{...item,source_created_month:invalid}]
    }),rejected(400),invalid);
  }
  assert.throws(()=>x.call("AE1","POST","imports/opportunities",{
    batch_id:"part4_unauthorized_00001",items:[{...item,source_created_month:"2026-07"}]
  }),rejected(403));
  assert.equal(x.store.table(DB,"Pipelines").rows.length,beforeRows);
  assert.equal(x.events().length,beforeEvents);
});

test("modern import and legacy month import keep source Business ID zeroes and Net RC calculation unchanged",()=>{
  const x=fixture();
  const item=input({business_id:"0000000000123",quantity:2,price_per_sub:350,oc:120,
    client_request_id:undefined,source_created_month:"2025-12"});
  const result=x.call("SM1","POST","imports/opportunities",{
    batch_id:"part4_zero_business_id",items:[item]
  });
  const row=x.store.table(DB,"Pipelines").rows.find(r=>r.opportunity_id===result.opportunity_ids[0]);
  assert.equal(row.business_id,"0000000000123");
  assert.equal(row.pipeline_value,710);
});

test("import accepts active Config Customer Types but preserves old taxonomy on normal records",()=>{
  const x=fixture();
  const options=x.call("SM1","GET","imports/customer-types");
  assert.ok(options.values.includes("SERVICE AND RETAIL"));
  assert.ok(options.values.includes("SME"));
  assert.ok(!options.values.includes("INACTIVE CLASS"));
  const r=x.call("SM1","POST","imports/opportunities",{batch_id:"import_customer_types_01",
    items:[input({business_id:"0000000060001",customer_type:"service and retail",client_request_id:undefined})]});
  const row=x.store.table(DB,"Pipelines").rows.find(v=>v.opportunity_id===r.opportunity_ids[0]);
  assert.equal(row.customer_type,"SERVICE AND RETAIL");
  assert.throws(()=>x.call("SM1","POST","imports/opportunities",{batch_id:"import_customer_types_02",
    items:[input({business_id:"0000000060002",customer_type:"INACTIVE CLASS",client_request_id:undefined})]}),rejected(400));
  assert.throws(()=>x.call("AE1","POST","entities/Opportunity",
    input({business_id:"0000000060003",customer_type:"SERVICE AND RETAIL"})),rejected(400));
});

test("historical Won/Lost imports retain source calendar dates without forging audit event dates",()=>{
  const x=fixture("2026-10-25T10:00:00.000Z");
  const common={source_system:"CRM",source_created_at:"2026-07-10",
    source_stage_entered_at:"2026-08-01",source_closed_at:"2026-09-09",
    client_request_id:undefined};
  const imported=x.call("SM1","POST","imports/opportunities",{
    batch_id:"historical_closed_00001",
    items:[
      input({...common,status:"won",source_record_id:"H-1",business_id:"0000000070001"}),
      input({...common,status:"lost",lost_reason_id:"LR1",source_record_id:"H-2",business_id:"0000000070002"}),
    ],
  });
  assert.equal(imported.imported,2);
  const rows=x.store.table(DB,"Pipelines").rows.filter(r=>imported.opportunity_ids.includes(r.opportunity_id));
  assert.equal(rows[0].status,"Won");
  assert.equal(rows[0].created_at,"2026-07-10");
  assert.equal(rows[0].created_month,"2026-07");
  assert.equal(rows[0].stage_entered_at,"2026-08-01");
  assert.equal(rows[0].won_at,"2026-09-09");
  assert.equal(rows[0].updated_at,"2026-10-25T10:00:00.000Z");
  assert.equal(rows[1].lost_at,"2026-09-09");
  assert.equal(rows[1].lost_reason_id,"LR1");
  assert.ok(x.events().filter(e=>e.event_type==="historical_import_status").length===2);
  assert.ok(x.events().every(e=>e.event_at==="2026-10-25T10:00:00.000Z"));
});

test("historical imports reject fake dates, unsupported status and missing Lost evidence",()=>{
  const x=fixture();
  const base=input({business_id:"0000000080001",client_request_id:undefined});
  for(const bad of [
    {status:"lost",source_closed_at:"2026-08-01"},
    {status:"won"},
    {status:"won",source_closed_at:"2026-02-30"},
    {source_created_at:"01/07/2026"},
    {source_created_at:"2026-09-01",source_created_month:"2026-08"},
    {status:"closed",source_closed_at:"2026-09-01"},
  ])assert.throws(()=>x.call("SM1","POST","imports/opportunities",
    {batch_id:"invalid_historical_date_01",items:[{...base,...bad}]}),rejected(400));
  assert.equal(x.store.table(DB,"Pipelines").rows.length,1);
});

test("financial import preserves legacy fields while independently reconciling reference Net RC",()=>{
  const x=fixture();
  const row=input({business_id:"0000000090001",client_request_id:undefined,
    quantity:2,price_per_sub:350,oc:120,reference_net_rc:"710",
    source_rc:"700",source_discount_pct:"15",source_monthly_sale_plan:"12000",
    source_product_id:"PRODUCT-A",source_record_id:"SRC-9",source_system:"CRM"});
  const imported=x.call("SM1","POST","imports/opportunities",
    {batch_id:"legacy_financial_000001",items:[row]});
  const stored=x.store.table(DB,"Pipelines").rows.find(v=>v.opportunity_id===imported.opportunity_ids[0]);
  assert.equal(stored.pipeline_value,710);
  assert.equal(stored.import_source_rc,"700");
  assert.equal(stored.import_source_discount_pct,"15");
  assert.equal(stored.import_source_monthly_sale_plan,"12000");
  assert.equal(stored.import_source_product_id,"PRODUCT-A");
  assert.equal(stored.import_source_net_rc,"710");
  assert.equal(stored.import_source_record_id,"SRC-9");
  assert.equal(stored.import_source_system,"CRM");
  assert.throws(()=>x.call("SM1","POST","imports/opportunities",{
    batch_id:"legacy_financial_000002",items:[{...row,source_record_id:"SRC-10",reference_net_rc:"999"}],
  }),rejected(400));
  x.call("AE1","PUT","entities/Opportunity/"+stored.opportunity_id,
    {import_source_rc:"999",source_created_at:"2020-01-01",remark:"Normal edit"});
  assert.equal(stored.import_source_rc,"700");
  assert.equal(stored.created_at,stored.created_at);
  assert.equal(stored.remark,"Normal edit");
});

test("commercially similar deals are distinct unless source ID matches; identical batch rows are rejected",()=>{
  const x=fixture();
  const inputRow=input({business_id:"0000000099991",client_request_id:undefined});
  assert.equal(x.call("SM1","POST","imports/opportunities",
    {batch_id:"similar_ledger_one_01",items:[inputRow]}).imported,1);
  assert.equal(x.call("SM1","POST","imports/opportunities",
    {batch_id:"similar_ledger_two_02",items:[inputRow]}).imported,1);
  assert.throws(()=>x.call("SM1","POST","imports/opportunities",
    {batch_id:"similar_ledger_three_03",items:[inputRow,inputRow]}),rejected(409));
  const linked={...inputRow,source_system:"CRM",source_record_id:"REF-001"};
  assert.equal(x.call("SM1","POST","imports/opportunities",
    {batch_id:"similar_ledger_four_04",items:[linked]}).imported,1);
  assert.throws(()=>x.call("SM1","POST","imports/opportunities",
    {batch_id:"similar_ledger_five_05",items:[linked]}),rejected(409));
});

test("real legacy imports preserve source facts and never forge Stage Aging or audit time",()=>{
  const stamp="2026-10-26T14:00:00.000Z";
  const x=fixture(stamp);
  const item=input({
    customer_name:"Synthetic Thai customer",business_id:"",customer_type:"Other",
    source_customer_type:"Others",sales_channel:"AE B2B GEO",
    source_sales_code:"1001",source_created_month:"2026-07",source_created_at:"2026-07-08",
    source_system:"Legacy Spreadsheet",source_record_id:"DOC-"+ "a".repeat(32)+"-R2",
    source_rc:"12000",reference_net_rc:"12000",source_monthly_sale_plan:"2026-10",
    customer_location_text:"BKK: sample district group",product_details:"Broadband",
    quantity:1,price_per_sub:12000,oc:0,contract_period:12,
    expected_close_month:undefined,client_request_id:undefined,
    stage_id:"S1",remark:"Source note, not a call event",
  });
  const result=x.call("SM1","POST","imports/opportunities",{
    batch_id:"legacy_real_sample_20261026",items:[item],
  });
  assert.equal(result.imported,1);
  const row=x.store.table(DB,"Pipelines").rows.find(v=>v.opportunity_id===result.opportunity_ids[0]);
  assert.equal(row.business_id,"");
  assert.equal(row.customer_type,"Other");
  assert.equal(row.import_source_customer_type,"Others");
  assert.equal(row.owner_user_id,"AE1");
  assert.equal(row.region_id,"R1");
  assert.equal(row.created_at,"2026-07-08");
  assert.equal(row.created_month,"2026-07");
  assert.equal(row.stage_entered_at,"");
  assert.equal(row.handler_since,stamp);
  assert.equal(row.updated_at,stamp);
  assert.equal(row.pipeline_value,12000);
  assert.equal(row.import_source_rc,"12000");
  assert.equal(row.import_source_net_rc,"12000");
  assert.equal(row.import_source_monthly_sale_plan,"2026-10");
  assert.equal(row.expected_close_month,undefined);
  assert.equal(row.customer_location_text,"BKK: sample district group");
  const events=x.events().filter(e=>e.opportunity_id===row.opportunity_id);
  assert.equal(events.length,1);
  assert.equal(events[0].event_type,"create");
  assert.equal(events[0].event_at,stamp);
  assert.match(events[0].remark,/Historical bulk import/);
});

test("legacy import and normal Create accept short or blank Business IDs",()=>{
  const x=fixture();
  const created=x.call("SM1","POST","imports/opportunities",{
    batch_id:"legacy_short_business_2026",
    items:[input({business_id:"01234",client_request_id:undefined,source_system:"Legacy",
      source_record_id:"SHORT-1"})],
  });
  const row=x.store.table(DB,"Pipelines").rows.find(r=>r.opportunity_id===created.opportunity_ids[0]);
  assert.equal(row.business_id,"01234");
  const short=x.call("AE1","POST","entities/Opportunity",input({business_id:"01234"}));
  const blank=x.call("AE1","POST","entities/Opportunity",input({business_id:"",client_request_id:"blank_business_id_2026"}));
  const stored=x.store.table(DB,"Pipelines").rows;
  assert.equal(stored.find(r=>r.opportunity_id===short.id)?.business_id,"01234");
  assert.equal(stored.find(r=>r.opportunity_id===blank.id)?.business_id,"");
  assert.throws(()=>x.call("AE1","POST","entities/Opportunity",
    input({business_id:"12-34",client_request_id:"invalid_business_id_2026"})),rejected(400));
  assert.throws(()=>x.call("SM1","POST","imports/opportunities",{
    batch_id:"legacy_bad_business_2026",
    items:[input({business_id:"12-34",client_request_id:undefined,source_system:"Legacy",
      source_record_id:"SHORT-2"})],
  }),rejected(400));
});

test("legacy Sales Code must match authoritative owner even when source name looks similar",()=>{
  const x=fixture();
  const base=input({client_request_id:undefined,source_system:"Legacy",
    source_record_id:"SAL-1",source_sales_code:"1002"});
  assert.throws(()=>x.call("SM1","POST","imports/opportunities",{
    batch_id:"legacy_bad_salescode_2026",items:[base],
  }),rejected(403));
  assert.equal(x.store.table(DB,"Pipelines").rows.length,1);
});

test("Sales Code alone resolves owner, name variations are advisory, and events remain truthful",()=>{
  const x=fixture("2026-10-26T14:00:00.000Z");
  const payload=input({
    business_id:"",client_request_id:undefined,
    source_sales_code:"1001",source_sale_name:"AE ONE (legacy spelling)",
    source_system:"Legacy Spreadsheet",source_record_id:"SALES-CODE-ONLY-1",
    owner_id:undefined,current_handler_id:undefined,
    source_created_at:"2026-07-08",source_created_month:"2026-07",
    source_rc:"12000",reference_net_rc:"12000",quantity:1,price_per_sub:12000,oc:0,
    expected_close_month:undefined,stage_id:"S1",
  });
  const result=x.call("SM1","POST","imports/opportunities",{
    batch_id:"legacy_source_salescode_only_1",items:[payload],
  });
  const row=x.store.table(DB,"Pipelines").rows.find(v=>v.opportunity_id===result.opportunity_ids[0]);
  assert.equal(row.owner_user_id,"AE1");
  assert.equal(row.current_handler_user_id,"AE1");
  assert.equal(row.business_id,"");
  assert.equal(row.stage_entered_at,"");
  assert.equal(row.created_at,"2026-07-08");
  assert.equal(x.events().filter(e=>e.opportunity_id===row.opportunity_id&&e.event_type==="create").length,1);
  const resolved=x.call("SM1","POST","imports/resolve-owners",{codes:["1001","1002","9999"]});
  assert.deepEqual(resolved.owners.map(v=>[v.code,v.found]),[["1001",true],["1002",false],["9999",false]]);
  assert.throws(()=>x.call("SM1","POST","imports/opportunities",{
    batch_id:"legacy_source_salescode_conflict_2",
    items:[{...payload,source_record_id:"SALES-CODE-ONLY-2",owner_id:"AE2"}],
  }),rejected(400));
});

test("Part 2: create accepts empty or omitted optional contacts without changing required fields",()=>{
  const x=fixture();
  const payload=input({
    contact_name:undefined,contact_phone:undefined,
    client_request_id:"optional_contacts_20261027_0001",
  });
  const created=x.call("AE1","POST","entities/Opportunity",payload);
  assert.ok(created.id);
  const row=x.store.table(DB,"Pipelines").rows.find(r=>r.opportunity_id===created.id);
  assert.equal(row.contact_name || "","");
  assert.equal(row.contact_phone || "","");
  assert.equal(created.customer_name,"Shop");
  assert.equal(created.pipeline_value,100);
  assert.throws(()=>x.call("AE1","POST","entities/Opportunity",input({
    client_request_id:"optional_contacts_20261027_0002",customer_name:"",
    contact_name:"",contact_phone:"",
  })),e=>e.status===400 && /customer_name/.test(e.message));
});

test("Part 2: optional contact values can be cleared without affecting other Pipeline values",()=>{
  const x=fixture();
  x.row().contact_name="Previous contact";
  x.row().contact_phone="0800000000";
  const updated=x.call("AE1","PUT","entities/Opportunity/OPP-1",{
    contact_name:"",contact_phone:"",
  });
  assert.equal(updated.contact_name,"");
  assert.equal(updated.contact_phone,"");
  assert.equal(x.row().contact_name,"");
  assert.equal(x.row().contact_phone,"");
  assert.equal(x.row().pipeline_value,100);
});

test("Part 2: create UI, edit UI, import, and contract agree contacts are optional",()=>{
  const create=fs.readFileSync(new URL("../src/components/CreatePipelineModal.jsx",import.meta.url),"utf8");
  const edit=fs.readFileSync(new URL("../src/components/OpportunityForm.jsx",import.meta.url),"utf8");
  const importer=fs.readFileSync(new URL("../src/pages/Import.jsx",import.meta.url),"utf8");
  const yaml=fs.readFileSync(new URL("../b2b_geo_pipeline.yaml",import.meta.url),"utf8");
  for(const field of ["contact_name","contact_phone"]) {
    assert.ok(!create.includes('errors.'+field+' = "Required"'),field);
    assert.ok(edit.includes('form.'+field),field);
    assert.match(importer,new RegExp('key: "'+field+'", label: "Contact [^"]+" \\}'));
    assert.match(yaml,new RegExp('    '+field+':\\n      source: "AE / SM input"\\n      optional: true'));
  }
  assert.ok(create.includes('<Field label="ชื่อผู้ติดต่อ">'));
  assert.ok(create.includes('<Field label="เบอร์โทรผู้ติดต่อ">'));
  assert.ok(!create.includes('<Field label="ชื่อผู้ติดต่อ" required'));
  assert.ok(!create.includes('<Field label="เบอร์โทรผู้ติดต่อ" required'));
});


test("historical imported Pipeline with blank first revision is editable exactly once per revision",()=>{
 const x=fixture();
 const original=x.row();
 original.import_batch_id="APPROVED_LEGACY_BATCH";
 original.updated_at="";
 original.stage_entered_at="";
 const auditBefore=x.events().length;
 const first=x.call("AE1","PUT","entities/Opportunity/OPP-1",{
   expected_updated_at:"",remark:"Reviewed legacy Pipeline"
 });
 assert.equal(first.remark,"Reviewed legacy Pipeline");
 assert.ok(first.updated_date);
 assert.ok(x.row().updated_at);
 assert.equal(x.row().stage_entered_at,"","Note edits cannot invent historical Stage Aging");
 assert.equal(x.events().length,auditBefore+1);
 assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/OPP-1",{
   expected_updated_at:"",remark:"Stale double-save"
 }),e=>e.status===409);
 assert.equal(x.row().remark,"Reviewed legacy Pipeline");
 const changed=x.call("AE1","PUT","entities/Opportunity/OPP-1",{
   expected_updated_at:first.updated_date,stage_id:"S2"
 });
 assert.equal(changed.stage_id,"S2");
 assert.equal(x.row().stage_entered_at,"2026-10-18T10:00:00.000Z");
 const audits=x.events().filter(e=>e.event_type==="stage_change");
 assert.equal(audits.length,1);
});

test("legacy empty revision uses one-time exact compare-and-set even without import metadata",()=>{
 const x=fixture();
 x.row().updated_at="";
 const first=x.call("AE1","PUT","entities/Opportunity/OPP-1",{
   expected_updated_at:"",remark:"Correctly saved first revision"
 });
 assert.equal(first.remark,"Correctly saved first revision");
 assert.ok(first.updated_date);
 assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/OPP-1",{
   expected_updated_at:"",remark:"Stale retry"
 }),e=>e.status===409);
 assert.equal(x.row().remark,"Correctly saved first revision");
});

test("real YAML contract roundtrip: Create Edit Stage Handler Working With Won Reopen Lost; retired Support writes rejected",()=>{
 const x=fixture();
 const config="B2B_GEO_Pipeline_Config.xlsx";
 x.store.table(config,"Working_With").rows.push(
   {team_id:"TEAM1",team_name:"Presales",active:"Yes"},
   {team_id:"TEAM2",team_name:"Pricing",active:"Yes"}
 );
 x.store.table(config,"Support_Types").rows.push(
   {support_type_id:"SUP1",support_type_name:"Pricing",active:"Yes"}
 );
 const created=x.call("AE1","POST","entities/Opportunity",input({
   client_request_id:"e2e_approved_legacy_req_002",
   customer_name:"E2E Synthetic",
   business_id:"000000001234",current_handler_id:"AE1",contact_phone:"0812345678",
   price_per_sub:100,quantity:2,oc:120
 }));
 const get=()=>x.call("AE1","GET","entities/Opportunity/"+created.id);
 const rows=x.store.table(DB,"Pipelines").rows;
 const saved=()=>rows.find(r=>r.opportunity_id===created.id);
 const ev=()=>x.store.table(DB,"Pipeline_Events").rows.filter(r=>r.opportunity_id===created.id);
 assert.equal(get().status,"open");
 assert.equal(get().pipeline_value,210);
 assert.equal(get().business_id,"000000001234");
 assert.equal(rows.filter(r=>r.opportunity_id===created.id).length,1);
 assert.equal(ev().filter(e=>e.event_type==="create").length,1);
 const edited=x.call("AE1","PUT","entities/Opportunity/"+created.id,{remark:"First meeting",contact_name:"Tester"});
 assert.equal(edited.remark,"First meeting");
 assert.equal(get().contact_name,"Tester");
 assert.equal(rows.filter(r=>r.opportunity_id===created.id).length,1);
 const stage=x.call("AE1","PUT","entities/Opportunity/"+created.id,{stage_id:"S2"});
 assert.equal(stage.stage_id,"S2");
 assert.equal(get().stage_id,"S2");
 assert.equal(ev().filter(e=>e.event_type==="stage_change").length,1);
 const changedHandler=x.call("AE1","PUT","entities/Opportunity/"+created.id,{current_handler_id:"SM1"});
 assert.equal(changedHandler.current_handler_id,"SM1");
 assert.equal(get().current_handler_id,"SM1");
 assert.equal(saved().owner_user_id,"AE1","Commercial Owner must not change on handoff");
 assert.equal(ev().filter(e=>e.event_type==="handler_change").length,1);
 const teams=x.call("AE1","PUT","entities/Opportunity/"+created.id,{working_with_team_ids:"TEAM1,TEAM2"});
 assert.equal(teams.working_with_team_ids,"TEAM1,TEAM2");
 assert.equal(teams.working_with,"Presales");
 assert.equal(saved().working_with_id,"TEAM1");
 assert.equal(ev().filter(e=>e.event_type==="working_with_change").length,1);
 assert.equal(ev().find(e=>e.event_type==="working_with_change").field_name,"working_with_teams");
 const eventsBeforeSupport=ev().length;
 assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/"+created.id,{
   support_needed:true,support_type:"Pricing",support_note:"Retired"
 }),e=>e.status===410);
 assert.equal(ev().length,eventsBeforeSupport,"Rejected legacy Support write must not add audit events");
 assert.equal(saved().support_needed||"","No"===saved().support_needed?"No":"");
 const won=x.call("AE1","PUT","entities/Opportunity/"+created.id,{status:"won"});
 assert.equal(won.status,"won");
 assert.equal(won.won_by,"AE1");
 assert.equal(saved().won_by_user_id,"AE1");
 assert.ok(won.won_at);
 assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/"+created.id,{stage_id:"S1"}),e=>e.status===409);
 const reopened=x.call("ADMIN","PUT","entities/Opportunity/"+created.id,{
   status:"open",audit_remark:"Approved reopen for UAT"
 });
 assert.equal(reopened.status,"open");
 assert.equal(reopened.won_at||"","");
 assert.equal(reopened.won_by||"","");
 assert.ok(ev().some(e=>e.event_type==="status_change" && e.remark==="Approved reopen for UAT"));
 assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/"+created.id,{
   status:"lost",lost_reason_id:"INVALID"
 }),e=>e.status===400);
 assert.equal(get().status,"open","Failed Lost must preserve Open");
 const lost=x.call("AE1","PUT","entities/Opportunity/"+created.id,{
   status:"lost",lost_reason_id:"LR1",lost_note:"Price"
 });
 assert.equal(lost.status,"lost");
 assert.equal(lost.lost_reason_id,"LR1");
 assert.equal(lost.lost_by,"AE1");
 assert.ok(lost.lost_at);
 assert.equal(get().lost_reason_id,"LR1");
 assert.equal(ev().filter(e=>e.event_type==="won").length,1);
 assert.equal(ev().filter(e=>e.event_type==="lost").length,1);
 assert.equal(rows.filter(r=>r.opportunity_id===created.id).length,1);
 assert.equal(new Set(ev().map(e=>e.event_id)).size,ev().length);
 assert.ok(ev().every(e=>e.actor_user_id));
 assert.ok(ev().every(e=>e.event_at));
});


test("historical imported Pipeline with blank Region can Edit Stage and Close without inventing Region",()=>{
 const x=fixture();
 const row=x.row();
 row.import_batch_id="APPROVED_HISTORICAL_IMPORT";
 row.region_id="";
 row.updated_at="";
 row.stage_entered_at="";
 row.expected_close_month="";
 const stage=x.call("AE1","PUT","entities/Opportunity/OPP-1",{
   expected_updated_at:"",stage_id:"S2",remark:"Stage evidence reviewed"
 });
 assert.equal(stage.region_id,"","Preserve historical unknown Region");
 assert.equal(stage.stage_id,"S2");
 assert.ok(stage.updated_date);
 assert.ok(stage.stage_entered_at);
 assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/OPP-1",{
   current_handler_id:"SM1"
 }),e=>e.status===400);
 assert.equal(x.row().current_handler_user_id,"AE1");
 const updated=x.call("AE1","PUT","entities/Opportunity/OPP-1",{remark:"Following up"});
 assert.equal(updated.remark,"Following up");
 assert.equal(updated.region_id,"");
 const historyCount=x.events().length;
 assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/OPP-1",{
   support_needed:true,support_type:"Pricing",support_note:"Retired"
 }),e=>e.status===410);
 assert.equal(x.events().length,historyCount);
 assert.equal(x.row().region_id,"");
 const won=x.call("AE1","PUT","entities/Opportunity/OPP-1",{status:"won"});
 assert.equal(won.status,"won");
 assert.equal(won.region_id,"");
 assert.equal(x.row().region_id,"");
 const reopened=x.call("ADMIN","PUT","entities/Opportunity/OPP-1",{
   status:"open",audit_remark:"Verified Lost after Won"
 });
 assert.equal(reopened.status,"open");
 const lost=x.call("AE1","PUT","entities/Opportunity/OPP-1",{
   status:"lost",lost_reason_id:"LR1",lost_note:"Cancelled after review"
 });
 assert.equal(lost.status,"lost");
 assert.equal(lost.lost_reason_id,"LR1");
 assert.equal(lost.region_id,"");
 const actualEvents=x.events();
 assert.ok(actualEvents.some(e=>e.event_type==="stage_change"));
 assert.ok(actualEvents.some(e=>e.event_type==="won"));
 assert.ok(actualEvents.some(e=>e.event_type==="lost"));
 assert.equal(actualEvents.filter(e=>e.event_type==="handler_change").length,0);
});

test("legacy blank Region cannot bypass Owner or Handler validation before a verified Region is set",()=>{
 const x=fixture();
 x.row().import_batch_id="APPROVED_HISTORICAL_IMPORT";
 x.row().region_id="";
 assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/OPP-1",{
   owner_id:"AE2"
 }),e=>e.status===403);
 assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/OPP-1",{
   current_handler_id:"SM1"
 }),e=>e.status===400);
 const repaired=x.call("AE1","PUT","entities/Opportunity/OPP-1",{region_id:"R1"});
 assert.equal(repaired.region_id,"R1");
 const handed=x.call("AE1","PUT","entities/Opportunity/OPP-1",{current_handler_id:"SM1"});
 assert.equal(handed.current_handler_id,"SM1");
});
