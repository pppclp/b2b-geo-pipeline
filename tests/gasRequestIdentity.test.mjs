import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../apps-script/Main.js", import.meta.url), "utf8");
const start = source.indexOf("function handle_(req) {");
const end = source.indexOf("function uatLogin_(store, body) {", start);
assert.ok(start >= 0 && end > start, "GAS authenticated request entrypoint must remain extractable");

function fixture() {
  const forwarded=[];
  const metrics={flushes:0,cores:0};
  const ctx={
    LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
    SheetStore_:function () {this.flush=()=>{metrics.flushes++};},
    GEO_CONTRACT:{},
    Utilities:{getUuid:()=> "synthetic-uuid"},
    GeoCoreLib:{createCore:()=>{
      metrics.cores++;
      return {handle:req=>{
        forwarded.push({...req});
        return {actor:req.userId};
      }};
    }},
    verifyUatSession_:token=>{
      if(token!=="signed-AE1") {
        const err=new Error("Invalid signed session");
        err.status=401;
        throw err;
      }
      return "AE1";
    },
    uatLogin_:()=>({user_id:"AE1",session_token:"signed-AE1"}),
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start,end),ctx);
  return {ctx,forwarded,metrics};
}

test("browser-forged userId is discarded and replaced by verified session identity",()=>{
  const {ctx,forwarded,metrics}=fixture();
  const claimed={method:"GET",path:"session/me",userId:"ADMIN1",sessionToken:"signed-AE1",demoAs:"ADMIN1"};
  assert.equal(ctx.handle_(claimed).actor,"AE1");
  assert.equal(forwarded[0].userId,"AE1");
  assert.equal(Object.hasOwn(forwarded[0],"sessionToken"),false);
  assert.equal(metrics.flushes,1);
});

test("missing or forged session prevents accessing the core and database flush",()=>{
  const {ctx,metrics}=fixture();
  for(const token of [undefined,"forged-AE1"]) {
    assert.throws(()=>ctx.handle_({method:"GET",path:"entities/Opportunity",userId:"ADMIN1",sessionToken:token}),e=>e.status===401);
  }
  assert.equal(metrics.cores,0);
  assert.equal(metrics.flushes,0);
});

test("only POST session/login bypasses signed-session verification",()=>{
  const {ctx,metrics}=fixture();
  const result=ctx.handle_({method:"POST",path:"session/login",body:{username:"synthetic",password:"synthetic"}});
  assert.equal(result.user_id,"AE1");
  assert.throws(()=>ctx.handle_({method:"GET",path:"session/login"}),e=>e.status===401);
  assert.equal(metrics.cores,0);
});
