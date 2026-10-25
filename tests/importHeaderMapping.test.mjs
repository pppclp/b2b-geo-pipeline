import test from "node:test";
import assert from "node:assert/strict";
import {mapImportHeaders,normalizeImportHeader} from "../src/lib/importHeaderMapping.js";
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

test("Create Month source headers map without touching Expected Close Month",()=>{
 const fields=[{key:"created_month",label:"Create Month"},{key:"expected_close_month",label:"Expected Close Month"}];
 assert.deepEqual(mapImportHeaders(["Create Month","Monthly Sale Plan"],fields),{created_month:0});
 assert.deepEqual(mapImportHeaders(["เดือนที่สร้าง","Expected Close Month"],fields),{created_month:0,expected_close_month:1});
});
