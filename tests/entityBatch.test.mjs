import test from "node:test";
import assert from "node:assert/strict";
import { unpackEntityBatch, fetchStartupData } from "../src/lib/entityBatch.js";

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

test("Part 3: startup fetches entities and Tasks in exactly one existing Core batch", async()=>{
  let invocations=0;
  const entities=["Region","TeamMember","Stage","Opportunity"];
  const requestsExpected=entities.map(entity=>({path:"entities/"+entity,query:{sort:"-created_date"}}));
  requestsExpected.push({path:"tasks"});
  requestsExpected.push({path:"config/sales-channels"});
  requestsExpected.push({path:"config/field-options/ccp_check_result"});
  const payload=[
    {status:200,body:[{id:"REG1"}]},
    {status:200,body:[{id:"AE1"}]},
    {status:200,body:[{id:"STG1"}]},
    {status:200,body:[{id:"OPP1",region_id:"R1"}]},
    {status:200,body:{items:[{opportunity_id:"OPP1",task_id:"T1",status:"not_started"}]}},
    {status:200,body:{options:[{value:"AE Self",label:"AE Self"}]}},
    {status:200,body:{options:[{value:"enterprise_base",label:"มีใน CCP+"},{value:"not_in_base",label:"ไม่มีใน CCP+"}]}},
  ];
  const result=await fetchStartupData(entities, async(requests)=>{
    invocations++;
    assert.deepEqual(requests,requestsExpected);
    return payload;
  });
  assert.equal(invocations,1,"Task read must not acquire a second Apps Script lock");
  assert.deepEqual(result.records,[...payload.slice(0,-3).map(row=>row.body)]);
  assert.deepEqual(result.taskEntries,payload.at(-3).body.items);
  assert.deepEqual(result.salesChannelOptions,payload.at(-2).body.options);
  assert.deepEqual(result.ccpCheckOptions,payload.at(-1).body.options);
});

test("Part 3: startup fails closed on Tasks errors, missing data and critical scope failure",async()=>{
  const entities=["Opportunity"];
  const rows={status:200,body:[{id:"OPP1"}]};
  for(const reply of [
    {status:403,body:{code:"FORBIDDEN"}},
    {status:503,body:{code:"SCHEMA_MISMATCH"}},
    {status:200,body:{}},
    {status:200,body:{items:{unexpected:"shape"}}},
  ]) {
    await assert.rejects(
      fetchStartupData(entities,async()=>[rows,reply,{status:200,body:{options:[{value:"AE Self",label:"AE Self"}]}},{status:200,body:{options:[{value:"enterprise_base",label:"มีใน CCP+"}]}}]),
      /Cannot load Tasks/
    );
  }
  await assert.rejects(fetchStartupData(entities,async()=>[rows]),/incomplete backend batch response/);
  await assert.rejects(fetchStartupData(entities,async()=>[
    {status:503,body:{message:"Pipeline sheet unavailable"}},
    {status:200,body:{items:[]}},
    {status:200,body:{options:[{value:"AE Self",label:"AE Self"}]}},
    {status:200,body:{options:[{value:"enterprise_base",label:"มีใน CCP+"}]}},
  ]),/Cannot load Opportunity \(503\)/);
});

test("Sales Channel Config is required and fails closed when old Apps Script lacks the endpoint", async()=>{
 const good=[{status:200,body:[{id:"OPP1"}]},{status:200,body:{items:[]}}];
 for(const reply of [
   {status:404,body:{message:"Not Found"}},{status:503,body:{code:"CONFIG_ERROR"}},
   {status:200,body:{options:[]}}, {status:200,body:{options:[{value:"",label:"Empty"}]}}
 ]) {
   await assert.rejects(fetchStartupData(["Opportunity"],async()=>[...good,reply,{status:200,body:{options:[{value:"enterprise_base",label:"มีใน CCP+"}]}}]),/Cannot load Sales Channel Config/);
 }
});

test("CCP+ Config must have an active option, never fall back to stale hard-coded labels",async()=>{
  await assert.rejects(fetchStartupData(["Opportunity"],async()=>[
    {status:200,body:[]},
    {status:200,body:{items:[]}},
    {status:200,body:{options:[{value:"AE Self",label:"AE Self"}]}},
    {status:200,body:{options:[]}},
  ]),/Cannot load CCP\+ Config/);
});

test("Part 3: no startup task cache, stale fallback or identity-based shortcut is introduced",async()=>{
  let requests=0;
  const fetchBatch=async()=>{
    requests++;
    return [{status:200,body:[]},{status:200,body:{items:[{task_id:"T"+requests}]}},{status:200,body:{options:[{value:"AE Self",label:"AE Self"}]}},{status:200,body:{options:[{value:"enterprise_base",label:"มีใน CCP+"}]}}];
  };
  const first=await fetchStartupData(["Opportunity"],fetchBatch);
  const second=await fetchStartupData(["Opportunity"],fetchBatch);
  assert.equal(requests,2);
  assert.deepEqual(first.taskEntries,[{task_id:"T1"}]);
  assert.deepEqual(second.taskEntries,[{task_id:"T2"}]);
  assert.deepEqual(second.salesChannelOptions,[{value:"AE Self",label:"AE Self"}]);
  assert.deepEqual(second.ccpCheckOptions,[{value:"enterprise_base",label:"มีใน CCP+"}]);
});
