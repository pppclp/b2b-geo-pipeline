import test from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../server/core.js";
import { loadContract } from "../server/contract.js";
import { legacyBusinessId, legacyImportBusinessId } from "../src/lib/legacyImport.js";

const DB="B2B_GEO_Pipeline_DB.xlsx", ORG="B2B_GEO_User_Org_Master.xlsx",
  CFG="B2B_GEO_Pipeline_Config.xlsx";
function fixture(){
  const contract=loadContract(new URL("../b2b_geo_pipeline.yaml",import.meta.url));
  const seed={
    [ORG+"/Users"]:[
      {user_id:"U0019",employee_id:"90009999",display_name:"Padhsarunpoj Rojpaithong",role:"AE",status:"Active"},
      {user_id:"SM1",employee_id:"777",display_name:"Synthetic SM",role:"SM",status:"Active"}],
    [ORG+"/User_Region"]:[
      {user_region_id:"UR1",user_id:"U0019",region_id:"N",active:"Yes"},
      {user_region_id:"UR2",user_id:"SM1",region_id:"N",active:"Yes"}],
    [ORG+"/Regions"]:[{region_id:"N",region_name:"North",active:"Yes"}],
    [ORG+"/Territories"]:[],
    [CFG+"/Stages"]:[{stage_id:"STG001",active:"Yes"},{stage_id:"STG003",active:"No"}],
    [CFG+"/Product_Categories"]:[{category_id:"CAT001",active:"Yes"}],
    [CFG+"/Lost_Reasons"]:[{reason_id:"LR1",active:"Yes"}],
    [CFG+"/Field_Options"]:[
      {field_key:"sales_channel",option_value:"AE Self",option_label:"AE Self",sort_order:1,active:"Yes"}],
    [DB+"/AE_Owner_Approval_20261027"]:[{
      "Decision":"Approved","Source Sales Code":"12709836",
      "Source Sale Name":"Padhsarunpoj Rojpaithong","Source Region":"North",
      "Source Row Numbers":"37, 38","Approved AE User ID":"U0019"
    }],
    [DB+"/Pipelines"]:[]
  };
  const tables={};const touched=[];
  const store={table(file,sheet){
    const key=file+"/"+sheet;
    if(!tables[key])tables[key]={headers:Object.keys((seed[key]||[])[0]||{}),
      rows:(seed[key]||[]).map(x=>({...x}))};
    return tables[key];
  },touch(file,sheet){touched.push(file+"/"+sheet);}};
  let seq=0;const core=createCore({contract,store,
    now:()=>"2026-11-01T10:00:00Z",uuid:()=>String(++seq)});
  const call=(method,path,body,actor="SM1")=>core.handle({userId:actor,method,path,body});
  return {call,store,touched};
}
const item=(row="37",other={})=>({
 source_system:"Legacy Spreadsheet",
 source_record_id:"DOC-79e97612cde3acfee14cfb26a78e0ddd-R"+row,
 source_sales_code:"12709836",source_original_sales_code:"12709836",
 source_sale_name:"Padhsarunpoj Rojpaithong",
 owner_id:"U0019",current_handler_id:"U0019",region_id:"N",
 customer_name:"Synthetic Customer "+row,customer_type:"Industrial",
 sales_channel:"AE Self",product_category_id:"CAT001",
 business_id:"AB-123",quantity:1,
 stage_id:"STG001",status:"open",expected_close_month:"2026-10",
 source_rc:"300",reference_net_rc:"300",...other
});
test("P0: historical Business ID accepts 1-40 raw characters without company uniqueness",()=>{
  assert.equal(legacyBusinessId("AB-123"),"AB-123");
  assert.equal(legacyBusinessId("Geovernment"),"Geovernment");
  assert.equal(legacyImportBusinessId("2.05565E+11"),"2.05565E+11");
  assert.equal(legacyBusinessId(""),"");
  assert.equal(legacyBusinessId("X".repeat(41)),null);
});
test("P0: server-side preview is read-only and uses approved AE despite differing Employee ID",()=>{
  const x=fixture();const result=x.call("POST","imports/preview",{items:[item()]});
  assert.equal(result.read_only,true);
  assert.equal(result.total,1);
  assert.equal(result.rows[0].status,"READY");
  assert.deepEqual(x.touched,[]);
  assert.equal(x.store.table(DB,"Pipelines").rows.length,0);
  assert.equal(x.store.table(DB,"Pipeline_Events").rows.length,0);
});
test("P0: approved source-row AE mapping preserves original sales code; retries skip, never rewrite",()=>{
  const x=fixture(),batch={batch_id:"historical_approved_20261101_a",items:[item()]};
  const result=x.call("POST","imports/opportunities",batch);
  assert.equal(result.imported,1);
  const saved=x.store.table(DB,"Pipelines").rows[0];
  assert.equal(saved.owner_user_id,"U0019");
  assert.equal(saved.import_source_sales_code,"12709836");
  assert.equal(saved.business_id,"AB-123");
  saved.remark="Edited later in production";
  const events=x.store.table(DB,"Pipeline_Events").rows.length;
  const retry=x.call("POST","imports/opportunities",{...batch,batch_id:"another_batch_replay_20261101"});
  assert.equal(retry.imported,0);
  assert.equal(retry.skipped,1);
  assert.equal(x.store.table(DB,"Pipelines").rows.length,1);
  assert.equal(x.store.table(DB,"Pipelines").rows[0].remark,"Edited later in production");
  assert.equal(x.store.table(DB,"Pipeline_Events").rows.length,events);
});
test("P0: two original source rows with same Business ID remain distinct opportunities",()=>{
  const x=fixture(),batch={batch_id:"historical_approved_20261101_b",items:[item("37"),item("38")]};
  const result=x.call("POST","imports/opportunities",batch);
  assert.equal(result.imported,2);
  const rows=x.store.table(DB,"Pipelines").rows;
  assert.equal(rows.length,2);
  assert.equal(rows[0].business_id,rows[1].business_id);
  assert.notEqual(rows[0].import_source_record_id,rows[1].import_source_record_id);
});
test("P0: duplicate technical IDs in same batch become POTENTIAL_DUPLICATE, not merged",()=>{
  const x=fixture();const result=x.call("POST","imports/preview",{items:[item(),item()]});
  assert.equal(result.rows[0].status,"READY");
  assert.equal(result.rows[1].status,"POTENTIAL_DUPLICATE");
  assert.deepEqual(x.touched,[]);
  assert.throws(()=>x.call("POST","imports/opportunities",
    {batch_id:"historical_approved_20261101_c",items:[item(),item()]}),
    e=>e.status===409);
});
test("P0: wrong approved Owner cannot pass approval even with same source code",()=>{
  const x=fixture(),bad=item("37",{owner_id:"SM1"});
  const out=x.call("POST","imports/preview",{items:[bad]});
  assert.equal(out.rows[0].status,"POTENTIAL_DUPLICATE");
  assert.equal(x.store.table(DB,"Pipelines").rows.length,0);
});
