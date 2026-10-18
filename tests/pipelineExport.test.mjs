import test from "node:test";
import assert from "node:assert/strict";
import { pipelineExportRows, PIPELINE_EXPORT_HEADERS } from "../src/lib/pipelineExport.js";

test("real .xlsx rows retain leading zeroes in Business IDs and phone numbers",()=>{
 const one={id:"OPP1",customer_name:"One",business_id:"0012345",contact_phone:"0812345678",pipeline_value:1200,status:"open",stage_id:"S1",region_id:"R1",quantity:2,price_per_sub:600};
 const rows=pipelineExportRows([one],{stage:{S1:{name:"Qualify",sla_days:7}},region:{R1:{name:"East"}}});
 assert.equal(rows.length,1);
 assert.equal(rows[0].length,PIPELINE_EXPORT_HEADERS.length);
 assert.equal(rows[0][2],"0012345");
 assert.equal(rows[0][7],"0812345678");
 assert.equal(rows[0][15],1200);
 assert.equal(rows[0][28],7);
});
test("empty exports still have the correct headers",()=>{
 assert.equal(pipelineExportRows([],{}).length,0);
 assert.equal(PIPELINE_EXPORT_HEADERS[0],"Opportunity ID");
});
