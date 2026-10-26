import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHistoricalGeoSource } from "../src/lib/historicalGeoSource.js";
import { makeHistoricalImportBatches } from "../src/lib/importBatches.js";
const headers = ["Create Month","Business ID","Customer Type","Customer Name","Sales Code",
  "Sale Name","Channel","Region","Province","Product Category","รายละเอียดสินค้า",
  "Sub","RC","Net RC","OC","Monthly Sale Plan","Stage (Current)","",""];
function data(tail){return ["4-มิ.ย.-26","","Industrial","Synthetic Customer","SYNTHETIC",
 "Synthetic Seller","AE B2B GEO","North","Synthetic Territory","Broadband","Test",
 "1","499","499","",...tail]}
test("all-region source detects shifted contract periods and keeps remarks",()=>{
 const east=data(["ต.ค.-26","Stage 1.เสนอราคา","First note","Second note"]);
 const north=data(["12 month","พ.ย.-26","Stage 2.เก็บเอกสาร","North note"]);
 const result=normalizeHistoricalGeoSource(headers,[east,north]);
 assert.deepEqual(result.layoutErrors,["",""]);
 assert.deepEqual(result.headers.slice(15),["Contract Period","Monthly Sale Plan","Stage (Current)","Remark"]);
 assert.deepEqual(result.rows[0].slice(15),["","ต.ค.-26","Stage 1.เสนอราคา","First note | Second note"]);
 assert.deepEqual(result.rows[1].slice(15),["12 month","พ.ย.-26","Stage 2.เก็บเอกสาร","North note"]);
});
test("ambiguous Contract Period is blocked without discarding original cells",()=>{
 const row=data(["9 Day","ต.ค.-26","Cancel Pending Review",""]);
 const v=normalizeHistoricalGeoSource(headers,[row]);
 assert.equal(v.rows[0][15],"9 Day");
 assert.match(v.layoutErrors[0],/cannot be verified/);
});
test("239 synthetic records become <=200 rows per retryable batch",()=>{
 const input=Array.from({length:239},(_,i)=>({id:"SYNTH-"+i}));
 const first=makeHistoricalImportBatches(input,"a".repeat(32));
 const second=makeHistoricalImportBatches(input,"a".repeat(32));
 assert.deepEqual(first.map(b=>b.items.length),[200,39]);
 assert.deepEqual(first.map(b=>b.batchId),second.map(b=>b.batchId));
 assert.equal(first[1].items[0].id,"SYNTH-200");
 assert.equal(new Set(first.flatMap(b=>b.items.map(x=>x.id))).size,239);
});
test("reject missing source fingerprints rather than risk duplicate retry IDs",()=>{
 assert.throws(()=>makeHistoricalImportBatches([{id:1}],"a"),/stable source document ID/);
});
