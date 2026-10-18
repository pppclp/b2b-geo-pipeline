import test from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../server/core.js";
import { loadContract } from "../server/contract.js";
import { fieldChoices } from "../src/lib/configChoices.js";

const contract=loadContract(new URL("../b2b_geo_pipeline.yaml",import.meta.url));
const CONFIG="B2B_GEO_Pipeline_Config.xlsx";
const DB="B2B_GEO_Pipeline_DB.xlsx";
const ORG="B2B_GEO_User_Org_Master.xlsx";
const PRODUCT="B2B_Product_Master.xlsx";

function appFixture() {
  const seed={
    [ORG+"/Users"]:[
      {user_id:"AE1",employee_id:"101",role:"AE",status:"Active",display_name:"AE"},
      {user_id:"SM1",employee_id:"201",role:"SM",status:"Active",display_name:"SM"},
    ],
    [ORG+"/User_Region"]:[
      {user_region_id:"UR1",user_id:"AE1",region_id:"N",active:"Yes"},
      {user_region_id:"UR2",user_id:"SM1",region_id:"N",active:"Yes"},
    ],
    [ORG+"/Regions"]:[{region_id:"N",region_name:"North",active:"Yes"}],
    [CONFIG+"/Stages"]:[{stage_id:"STG001",stage_name:"Stage 1",active:"Yes"}],
    [CONFIG+"/Field_Options"]:[
      {option_id:"OPT001",field_key:"sales_channel",option_value:"AE Self",option_label:"AE Self",sort_order:1,active:"Yes"},
      {option_id:"OPT002",field_key:"sales_channel",option_value:"Test New Channel",option_label:"New Channel",sort_order:2,active:"Yes"},
      {option_id:"OPT003",field_key:"sales_channel",option_value:"Retired Channel",option_label:"Retired",sort_order:3,active:"No"},
      {option_id:"OPT004",field_key:"ccp_check_result",option_value:"not_in_base",option_label:"New Customer",sort_order:1,active:"Yes"},
      {option_id:"OPT005",field_key:"ccp_check_result",option_value:"reviewed",option_label:"Reviewed",sort_order:2,active:"Yes"},
    ],
    [PRODUCT+"/Product_Categories"]:[{category_id:"CAT1",category_name:"TOL",active:"Yes"}],
    [DB+"/Pipelines"]:[{
      opportunity_id:"P1",customer_name:"Shop",owner_user_id:"AE1",original_owner_user_id:"AE1",
      current_handler_user_id:"AE1",region_id:"N",stage_id:"STG001",
      status:"Open",sales_channel:"AE Self",ccp_check_result:"not_in_base",
      product_category_id:"CAT1",expected_close_month:"2026-11",
      quantity:1,price_per_sub:100,pipeline_value:100,
    }],
  };
  const tables={};
  const store={
    table(file,sheet){
      const k=file+"/"+sheet;
      if(!tables[k])tables[k]={headers:Object.keys(seed[k]?.[0]||{}),rows:seed[k]||[]};
      return tables[k];
    },
    touch(){},
  };
  let n=0;
  const core=createCore({contract,store,uuid:()=>String(++n),now:()=>"2026-10-18T10:00:00.000Z"});
  return {
    call:(id,method,path,body)=>core.handle({userId:id,method,path,body}),
    row:()=>store.table(DB,"Pipelines").rows[0],
  };
}

test("Runtime YAML contract exposes existing Field_Options read-only to AE and SM",()=>{
  const config=contract.access.files[CONFIG].sheets.Field_Options;
  assert.equal(config.entity,"field_options");
  assert.equal(config.primary_key,"option_id");
  assert.deepEqual(config.permissions.create,[]);
  assert.ok(config.permissions.read.includes("AE"));
  const app=appFixture();
  const values=app.call("AE1","GET","entities/FieldOption");
  assert.equal(values.length,5);
  assert.equal(values.find(x=>x.id==="OPT002").value,"Test New Channel");
  assert.equal(values.find(x=>x.id==="OPT004").label,"New Customer");
  assert.equal(values.find(x=>x.id==="OPT003").active,false);
  assert.equal(app.call("SM1","GET","entities/FieldOption").length,5);
  assert.throws(()=>app.call("SM1","POST","entities/FieldOption",{value:"Bad"}),(e)=>e.status===403);
});

test("Config dropdown helper preserves order and excludes inactive values",()=>{
  const app=appFixture();
  const master={FieldOption:app.call("AE1","GET","entities/FieldOption")};
  assert.deepEqual(fieldChoices(master,"sales_channel"),[
    {value:"AE Self",label:"AE Self"},{value:"Test New Channel",label:"New Channel"},
  ]);
  assert.deepEqual(fieldChoices(master,"ccp_check_result"),[
    {value:"not_in_base",label:"New Customer"},{value:"reviewed",label:"Reviewed"},
  ]);
});

test("Backend accepts active configurable Sales Channel / CCP+ but rejects retired values",()=>{
  const x=appFixture();
  x.call("AE1","PUT","entities/Opportunity/P1",{sales_channel:"Test New Channel"});
  assert.equal(x.row().sales_channel,"Test New Channel");
  x.call("SM1","PUT","entities/Opportunity/P1",{ccp_check_result:"reviewed"});
  assert.equal(x.row().ccp_check_result,"reviewed");
  assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/P1",{sales_channel:"Retired Channel"}),(e)=>e.status===400);
  assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/P1",{ccp_check_result:"bad_code"}),(e)=>e.status===400);
  assert.equal(x.row().sales_channel,"Test New Channel");
  assert.equal(x.row().ccp_check_result,"reviewed");
});
