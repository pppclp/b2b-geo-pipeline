import test from "node:test";
import assert from "node:assert/strict";
import { probeApi } from "../scripts/smoke-api-readonly.mjs";
import { API_CONTRACT_VERSION, REQUIRED_CAPABILITIES } from "../src/lib/apiContract.js";

const endpoint="https://script.google.com/macros/s/TEST_ONLY/exec";
const fakeFetch=(payload,seen)=>async (_url,options)=>{
  seen.push(options);
  return {ok:true,json:async()=>seen.length===1?{
    status:200,health:true,body:{service:"B2B GEO Pipeline API"}
  }:{status:200,body:payload}};
};

test("API smoke without credentials sends only public read-only health GET",async()=>{
  const seen=[];
  const result=await probeApi({apiUrl:endpoint,fetchImpl:fakeFetch(null,seen)});
  assert.deepEqual(result,{health:"ok",contract:"not-checked-no-test-session"});
  assert.equal(seen.length,1);
  assert.equal(seen[0].method,"GET");
});
test("authorized test session checks contract using POST text/plain without leaking token to URL",async()=>{
  const seen=[];
  const result=await probeApi({apiUrl:endpoint,sessionToken:"SYNTHETIC_TOKEN",fetchImpl:fakeFetch({
    id:"SYNTHETIC",api_contract_version:API_CONTRACT_VERSION,capabilities:[...REQUIRED_CAPABILITIES]
  },seen)});
  assert.deepEqual(result,{health:"ok",contract:"compatible"});
  assert.equal(seen[1].method,"POST");
  assert.equal(seen[1].headers["Content-Type"],"text/plain;charset=utf-8");
  const body=JSON.parse(seen[1].body);
  assert.equal(body.path,"session/me");
  assert.equal(body.sessionToken,"SYNTHETIC_TOKEN");
});
test("outdated backend contract fails clearly, without displaying empty Pipeline data",async()=>{
  await assert.rejects(()=>probeApi({apiUrl:endpoint,sessionToken:"SYNTHETIC_TOKEN",
    fetchImpl:fakeFetch({id:"SYNTHETIC",api_contract_version:0,capabilities:[]},[])}),
    e=>e.code==="API_CONTRACT_MISMATCH"&&e.status===503);
});
test("API smoke refuses non-Apps-Script, query-string and non-HTTPS destinations",async()=>{
  for(const apiUrl of ["http://script.google.com/a/exec","https://example.org/a/exec",
    "https://script.google.com/macros/s/TEST/exec?token=secret"]) {
    await assert.rejects(()=>probeApi({apiUrl}),/approved script.google.com HTTPS/);
  }
});
