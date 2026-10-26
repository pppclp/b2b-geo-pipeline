import test from "node:test";
import assert from "node:assert/strict";
import { legacyNumber, legacyContractMonths, legacyStageName, legacyCustomerType, legacyProductCategory,
  legacySourceMonth, legacyBusinessId, legacyImportBusinessId, legacyRowSourceId } from "../src/lib/legacyImport.js";
import { mapImportHeaders } from "../src/lib/importHeaderMapping.js";

test("source file's 19-column headers map to explicit approved legacy fields",()=>{
  const headers=["Create Month","Business ID","Customer Type","Customer Name","Sales Code","Sale Name",
    "Channel","Region","Province","Product Category","รายละเอียดสินค้า","Sub","RC","Net RC","OC",
    "Contract Period","Monthly Sale Plan","Stage (Current)","หมายเหตุ"];
  const fields=[
    ["created_month","Create Month"],["business_id","Business ID"],["customer_type","Customer Type"],
    ["customer_name","Customer Name"],["source_sales_code","Sales Code"],["source_sale_name","Sale Name"],
    ["sales_channel","Sales Channel"],["region","Region"],["customer_location_text","Customer Location / Province"],
    ["product_category","Product Category"],["product_details","Product Details"],["quantity","Number of Subs"],
    ["source_rc","Source RC"],["reference_net_rc","Reference Net RC"],["oc","OC"],
    ["contract_period","Contract Period"],["source_monthly_sale_plan","Source Monthly Sale Plan"],
    ["stage","Stage"],["remark","Remark"],
  ].map(([key,label])=>({key,label}));
  const mapping=mapImportHeaders(headers,fields);
  assert.equal(Object.keys(mapping).length,19);
  for(let i=0;i<headers.length;i++)assert.ok(Object.values(mapping).includes(i),headers[i]);
  assert.equal(mapping.source_monthly_sale_plan,16);
  assert.equal(mapping.source_sale_name,5);
  assert.equal(mapping.source_sales_code,4);
});
test("strict transformations retain true sales semantics",()=>{
  assert.equal(legacyNumber(" 12,000 " ),12000);
  assert.equal(legacyNumber("12,000.50"),12000.5);
  assert.equal(legacyNumber("12,0"),null);
  assert.equal(legacyNumber("=1+1"),null);
  assert.equal(legacyContractMonths("12 month"),12);
  assert.equal(legacyContractMonths("12 เดือน"),12);
  assert.equal(legacyContractMonths("12 months"),12);
  assert.equal(legacyContractMonths("12months"),12);
  assert.equal(legacyContractMonths("12.5 months"),null);
  assert.equal(legacyStageName("Stage 1.ติดต่อนำเสนอ/ยื่นใบเสนอราคา (50%)"),"Stage 1");
  assert.equal(legacyCustomerType("Others"),"Other");
  assert.equal(legacyProductCategory("Broadband"),"TOL");
  assert.equal(legacyProductCategory("Postpaid"),"TMH");
  assert.equal(legacyProductCategory("Solutions"),"Solution");
  assert.equal(legacyProductCategory("CorpNet/Data Services"),"CorpNet/Data Services");
  assert.equal(legacySourceMonth("Oct-26"),"2026-10");
  assert.equal(legacySourceMonth("ต.ค.-26"),"2026-10");
  assert.equal(legacySourceMonth("Sep_26"),"2026-09");
  assert.equal(legacySourceMonth("2026-10"),"2026-10");
  assert.equal(legacySourceMonth("Oct-99"),"1999-10");
  assert.equal(legacySourceMonth("12,000"),null);
  assert.equal(legacyBusinessId(""),"");
  assert.equal(legacyBusinessId("8123"),"8123");
  assert.equal(legacyBusinessId("0001"),"0001");
  assert.equal(legacyBusinessId("12-13"),null);
  assert.equal(legacyImportBusinessId("2.05565E+11"),"");
  assert.equal(legacyImportBusinessId("0000123"),"0000123");
  assert.equal(legacyImportBusinessId("Geovernment"),null);
  assert.equal(legacyImportBusinessId("12-34"),null);
  assert.equal(legacyRowSourceId("a".repeat(32),2),"DOC-"+"a".repeat(32)+"-R2");
});
