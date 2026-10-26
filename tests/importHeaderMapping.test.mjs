import test from "node:test";
import assert from "node:assert/strict";
import {mapImportHeaders,normalizeImportHeader,needsExplicitCreatedMonthMapping} from "../src/lib/importHeaderMapping.js";
const fields=[{key:"customer_name",label:"Customer Name"},{key:"contact_name",label:"Contact Name"},{key:"business_id",label:"Business ID"},{key:"region",label:"Region"},{key:"stage",label:"Stage"}];
test("maps distinct Thai headers without collapsing to empty",()=>{
  const headers=["ชื่อลูกค้า","ชื่อผู้ติดต่อ","เลขทะเบียนนิติบุคคล","ภูมิภาค","ขั้นตอนการขาย"];
  assert.deepEqual(mapImportHeaders(headers,fields),{customer_name:0,contact_name:1,business_id:2,region:3,stage:4});
});
test("does not auto-map unknown Thai columns or reuse one column",()=>{
  assert.deepEqual(mapImportHeaders(["ข้อมูลอิสระ"],fields),{});
  assert.deepEqual(mapImportHeaders(["ชื่อลูกค้า"],fields),{customer_name:0});
  assert.equal(normalizeImportHeader("  "), "");
});
test("does not guess when a header is duplicated",()=>{
  assert.deepEqual(mapImportHeaders(["Customer Name","Customer Name"],fields),{});
});
test("matches English headers with punctuation but no substring false positives",()=>{
  assert.deepEqual(mapImportHeaders(["Business-ID","Stage", "Region Group"],fields),{business_id:0,stage:1});
});

test("legacy source month aliases map without stealing Expected Close Month",()=>{
  const fields=[{key:"created_month",label:"Create Month"},
    {key:"expected_close_month",label:"Expected Close Month"}];
  assert.deepEqual(mapImportHeaders(["Create Month","Expected Close Month"],fields),
    {created_month:0,expected_close_month:1});
  assert.deepEqual(mapImportHeaders(["เดือนที่สร้าง","Expected Close Month"],fields),
    {created_month:0,expected_close_month:1});
  assert.deepEqual(mapImportHeaders(["Created Month","Monthly Sale Plan"],fields),{created_month:0});
});
test("duplicate Create Month source headers are never mapped by guess",()=>{
  const fields=[{key:"created_month",label:"Create Month"}];
  assert.deepEqual(mapImportHeaders(["Create Month","Created Month"],fields),{});
  assert.deepEqual(mapImportHeaders(["Created Month","Created Month"],fields),{});
});

test("recognized but unmapped source-created month is blocked until manually selected",()=>{
  const headers=["Created Month","Create Month","Customer Name"];
  assert.equal(needsExplicitCreatedMonthMapping(headers,{}),true);
  assert.equal(needsExplicitCreatedMonthMapping(headers,{created_month:1}),false);
  assert.equal(needsExplicitCreatedMonthMapping(["Customer Name","Expected Close Month"],{}),false);
  assert.equal(needsExplicitCreatedMonthMapping(["เดือนที่สร้าง","Customer Name"],{}),true);
});

test("legacy product / finance columns are not silently mistaken for live pricing",()=>{
  const fields=[
    {key:"product_details",label:"Product Details"},
    {key:"product_category",label:"Product Category"},
    {key:"source_product_id",label:"Legacy Product ID"},
    {key:"source_rc",label:"Source RC"},
    {key:"source_discount_pct",label:"Source Discount %"},
    {key:"source_monthly_sale_plan",label:"Source Monthly Sale Plan"},
    {key:"reference_net_rc",label:"Reference Net RC"},
    {key:"owner",label:"Opportunity Owner"},
  ];
  assert.deepEqual(mapImportHeaders([
    "Product Name","Product Category","Product ID","RC","Discount %","Monthly Sale Plan","Net RC","AE Name"
  ],fields),{product_details:0,product_category:1,source_product_id:2,
    source_rc:3,source_discount_pct:4,source_monthly_sale_plan:5,reference_net_rc:6,owner:7});
  assert.deepEqual(mapImportHeaders(["Owner User ID","Region ID"],
    [{key:"owner",label:"Opportunity Owner"},{key:"region",label:"Region"}]),
    {owner:0,region:1});
});
