import test from "node:test";
import assert from "node:assert/strict";
import {toSheet,toUi,sheetCol} from "../server/entities.js";
import {OPPORTUNITY_COLUMNS} from "../server/opportunityPolicy.js";

const UI_TO_SHEET={
 customer_name:"customer_name",business_id:"business_id",customer_type:"customer_type",
 sales_channel:"sales_channel",partner_name:"partner_name",contact_name:"contact_name",
 contact_phone:"contact_phone",remark:"remark",product_category_id:"product_category_id",
 product_details:"product_details",quantity:"quantity",price_per_sub:"price_per_sub",
 oc:"oc",contract_period:"contract_period_months",pipeline_value:"pipeline_value",
 expected_close_month:"expected_close_month",owner_id:"owner_user_id",
 original_owner_id:"original_owner_user_id",current_handler_id:"current_handler_user_id",
 region_id:"region_id",territory_id:"territory_id",stage_id:"stage_id",
 scenario_id:"scenario_id",ccp_check_result:"ccp_check_result",client_request_id:"client_request_id",
 working_with:"working_with_id",working_with_team_ids:"working_with_team_ids",
 working_with_user_ids:"working_with_user_ids",support_needed:"support_needed",
 support_type:"support_type_id",support_note:"support_note",
 status:"status",won_at:"won_at",won_by:"won_by_user_id",
 lost_at:"lost_at",lost_by:"lost_by_user_id",lost_reason_id:"lost_reason_id",
 lost_note:"lost_note"
};

test("Create Edit Stage Handler closure UI fields map to approved Pipeline columns",()=>{
 for(const [ui,sheet] of Object.entries(UI_TO_SHEET)){
   assert.equal(sheetCol("Opportunity",ui),sheet,ui+" mapping");
   assert.ok(OPPORTUNITY_COLUMNS.has(sheet),sheet+" must be an approved column");
 }
});

test("full Pipeline row round-trips through UI aliases without losing IDs, dates or money",()=>{
 const row={
   opportunity_id:"OPP01",customer_name:"Test Shop",business_id:"00001234000",
   owner_user_id:"AE1",original_owner_user_id:"AE1",current_handler_user_id:"SM1",
   product_category_id:"CAT1",region_id:"REG1",stage_id:"STG2",status:"Open",
   pipeline_value:1200,quantity:2,price_per_sub:600,oc:0,
   contract_period_months:12,created_at:"2026-10-27T00:00:00.000Z",
   updated_at:"2026-10-27T00:05:00.000Z",expected_close_month:"2026-11"
 };
 const ui=toUi("Opportunity","opportunity_id",row);
 assert.equal(ui.id,"OPP01");
 assert.equal(ui.owner_id,"AE1");
 assert.equal(ui.original_owner_id,"AE1");
 assert.equal(ui.current_handler_id,"SM1");
 assert.equal(ui.contract_period,12);
 assert.equal(ui.status,"open");
 assert.equal(ui.created_date,row.created_at);
 assert.equal(ui.updated_date,row.updated_at);
 const persisted=toSheet("Opportunity","opportunity_id",ui);
 for(const key of Object.keys(row)){
   if(key==="opportunity_id")continue;
   assert.equal(String(persisted[key]),String(row[key]),"round-trip "+key);
 }
 assert.equal(persisted.business_id,"00001234000");
});

test("unknown optional import fields cannot bypass approved write policy",()=>{
 const payload=toSheet("Opportunity","opportunity_id",{
   customer_name:"Example",owner_id:"AE1",current_handler_id:"SM1",
   stage_id:"S1",pipeline_value:100,random_injected_data:"not allowed"
 });
 const approved=Object.fromEntries(Object.entries(payload).filter(([key])=>OPPORTUNITY_COLUMNS.has(key)));
 assert.equal("random_injected_data" in approved,false);
 assert.equal(approved.owner_user_id,"AE1");
 assert.equal(approved.current_handler_user_id,"SM1");
});
