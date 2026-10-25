import test from "node:test";
import assert from "node:assert/strict";
import { unpackEntityBatch } from "../src/lib/entityBatch.js";

test("Critical Opportunity failure is not silently treated as zero Pipelines",()=>{
 const names=["Region","TeamMember","Stage","Opportunity","OpportunityHistory"];
 const results=names.map(()=>({status:200,body:[]}));
 results[3]={status:403,body:{message:"No data access"}};
 assert.throws(()=>unpackEntityBatch(names,results),/Cannot load Opportunity \(403\)/);
 results[3]={status:503,body:{message:"Pipeline DB property points to a different workbook"}};
 assert.throws(()=>unpackEntityBatch(names,results),/Cannot load Opportunity \(503\).*Pipeline DB property points to a different workbook/);
});

test("Missing TeamMember or Stage signals broken role/filter setup",()=>{
 for (const required of ["TeamMember","Stage"]) {
   assert.throws(()=>unpackEntityBatch([required],[{status:401,body:{message:"Expired"}}]),/Cannot load/);
 }
});

test("Optional master access failure does not break successful Pipeline fetch",()=>{
 const result=unpackEntityBatch(["Product","Opportunity"],[
   {status:403,body:{message:"Not allowed"}},
   {status:200,body:[{id:"OPP-1"}]},
 ]);
 assert.deepEqual(result,[[],[{id:"OPP-1"}]]);
});

test("Incomplete or malformed batch response is rejected",()=>{
 assert.throws(()=>unpackEntityBatch(["Opportunity"],[]),/incomplete backend/);
 assert.throws(()=>unpackEntityBatch(["Opportunity"],{}),/incomplete backend/);
 assert.throws(()=>unpackEntityBatch(["Opportunity"],[{status:200,body:{}}]),/Cannot load Opportunity/);
});

test("Optional master HTTP 503 is a hard failure, not an empty master",()=>{
 assert.throws(()=>unpackEntityBatch(["LostReason","Opportunity"],[
  {status:503,body:{code:"REQUIRED_SHEET_MISSING",message:"Backend unavailable"}},
  {status:200,body:[{id:"OPP-1"}]},
 ]),/Cannot load LostReason \(503, REQUIRED_SHEET_MISSING\)/);
});
