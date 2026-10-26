import test from "node:test";
import assert from "node:assert/strict";
import { buildSnapshotRows, replaceSnapshotPeriod, snapshotPeriodValid } from "../server/snapshot.js";
test("reject invalid month and malformed source before changing stored month", () => {
  assert.equal(snapshotPeriodValid("2026-13"), false);
  assert.throws(()=>buildSnapshotRows([], "bad", "", ()=>"SNP1"));
  assert.throws(()=>buildSnapshotRows([{ opportunity_id:"O", status:"open" }, { opportunity_id:"O", status:"won" }],"2026-10","today",()=> "SNP"),/Duplicate/);
});
test("published month is immutable; new months append without rewriting history",()=>{
 const old = [{snapshot_id:"OLD1",snapshot_period:"2026-09",opportunity_id:"O1"},{snapshot_id:"OLD2",snapshot_period:"2026-10",opportunity_id:"O2"}];
 const incoming=[{snapshot_id:"NEW",snapshot_period:"2026-10",opportunity_id:"O3"}];
 assert.throws(()=>replaceSnapshotPeriod(old,"2026-10",incoming),/already captured/);
 const november=[{snapshot_id:"NOV",snapshot_period:"2026-11",opportunity_id:"O3"}];
 assert.deepEqual(replaceSnapshotPeriod(old,"2026-11",november),[...old,...november]);
});
test("snapshot rows are built from server columns (not browser data)",()=>{
 const rows=buildSnapshotRows([{opportunity_id:"O",owner_user_id:"AE",current_handler_user_id:"SM",handler_since:"since",status:"open",pipeline_value:100,contract_period_months:12,stage_id:"S1"}],"2026-10","captured",()=> "SN1");
 assert.equal(rows[0].contract_value,1200);
 assert.equal(rows[0].handoff_at,"since");
 assert.equal(rows[0].snapshot_id,"SN1");
});

test("Import-friendly snapshot freezes source facts, AE identity, and a separate calculated Net RC",()=>{
 const imported={
   opportunity_id:"OPP-L-1",customer_name:"Synthetic imported customer",
   business_id:"",customer_type:"Other",created_at:"2026-07-08",
   created_month:"2026-07",owner_user_id:"AE1",status:"Open",
   product_category_id:"CAT001",product_details:"Broadband",quantity:1,
   price_per_sub:12000,pipeline_value:12000,oc:0,contract_period_months:12,
   stage_id:"STG001",stage_entered_at:"",expected_close_month:"",
   remark:"No contact established; source note only",
   customer_location_text:"BKK : Phaya Thai, Din Daeng, Huai Khwang",
   import_source_customer_type:"Others",import_source_rc:"12000",
   import_source_net_rc:"12000",import_source_monthly_sale_plan:"2026-10",
   import_source_system:"Legacy Spreadsheet",import_source_record_id:"DOC-abcd-R2",
   import_batch_id:"test_legacy_batch_20261026",
 };
 const users=new Map([["AE1",{user_id:"AE1",employee_id:"90007217",display_name:"Jirapa Kerdkwan"}]]);
 const output=buildSnapshotRows([imported],"2026-10","2026-10-31T16:59:59Z",
   ()=>"SNP-L-1",users);
 assert.equal(output.length,1);
 assert.equal(output[0].created_month,"2026-07");
 assert.equal(output[0].owner_sales_code,"90007217");
 assert.equal(output[0].owner_sale_name,"Jirapa Kerdkwan");
 assert.equal(output[0].customer_location_text,imported.customer_location_text);
 assert.equal(output[0].import_source_customer_type,"Others");
 assert.equal(output[0].import_source_rc,"12000");
 assert.equal(output[0].import_source_net_rc,"12000");
 assert.equal(output[0].import_source_monthly_sale_plan,"2026-10");
 assert.equal(output[0].import_source_record_id,"DOC-abcd-R2");
 assert.equal(output[0].import_batch_id,imported.import_batch_id);
 assert.equal(output[0].expected_close_month,"");
 assert.equal(output[0].pipeline_value,12000);
 assert.equal(output[0].contract_value,144000);
 assert.equal(output[0].stage_id,"STG001");
 assert.equal(output[0].stage_last_updated_at,"");
 // Captures are value snapshots, not live references to mutable Pipeline data.
 imported.import_source_rc="9999";
 users.get("AE1").display_name="Changed Later";
 assert.equal(output[0].import_source_rc,"12000");
 assert.equal(output[0].owner_sale_name,"Jirapa Kerdkwan");
});
test("No user master, no source data: optional legacy fields remain blank",()=>{
 const row=buildSnapshotRows([
   {opportunity_id:"OPP-N-1",owner_user_id:"UNKNOWN",status:"Open",pipeline_value:50}
 ],"2026-10","captured",()=> "SN-A")[0];
 assert.equal(row.owner_sales_code,"");
 assert.equal(row.owner_sale_name,"");
 assert.equal(row.created_month,"");
 assert.equal(row.import_source_rc,"");
 assert.equal(row.import_source_net_rc,"");
 assert.equal(row.import_source_monthly_sale_plan,"");
 assert.equal(row.customer_location_text,"");
});
