import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Exercise the actual Google Apps Script helper (not a separate reimplementation).
const main = readFileSync(new URL("../apps-script/Main.js",import.meta.url),"utf8");
const start = main.indexOf("function uatEnsureFirstLoginSecrets_(store) {");
const end = main.indexOf("// ---- UAT first-login password setup",start);
assert.ok(start >= 0 && end > start, "UAT secret-preparation helper exists");

function setup({env="UAT",flag="true",pepper="",secret="",hashes=[]}={}) {
  const state = new Map([["GEO_ENVIRONMENT",env],
    ["GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED",flag]]);
  if (pepper) state.set("GEO_UAT_PASSWORD_PEPPER",pepper);
  if (secret) state.set("GEO_UAT_ACTIVATION_SECRET",secret);
  const setCount = {};
  const props = {
    getProperty:k=>state.get(k)||"",
    setProperty:(k,v)=>{state.set(k,v);setCount[k]=(setCount[k]||0)+1;},
  };
  const credentials = hashes.map((password_hash,i)=>({user_id:"U"+i,password_hash}));
  const calls = {table:0};
  const store = {table:(file,sheet)=>{
    assert.equal(file,"B2B_GEO_UAT_Credentials_Distribution.xlsx");
    assert.equal(sheet,"UAT_Credentials");
    calls.table++;
    return {rows:credentials};
  }};
  const ctx = {
    PropertiesService:{getScriptProperties:()=>props},
    GEO_UAT_PASSWORD_PEPPER_PROPERTY_:"GEO_UAT_PASSWORD_PEPPER",
    uatTemporarySetupEnabled_:()=>props.getProperty("GEO_ENVIRONMENT")==="UAT"&&
      props.getProperty("GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED")==="true",
    uatPasswordPepper_:create=>{
      assert.equal(create,true);
      const old=props.getProperty("GEO_UAT_PASSWORD_PEPPER");
      if (old) return old;
      props.setProperty("GEO_UAT_PASSWORD_PEPPER","generated-uat-pepper");
      return "generated-uat-pepper";
    },
    uatActivationSecret_:create=>{
      assert.equal(create,true);
      const old=props.getProperty("GEO_UAT_ACTIVATION_SECRET");
      if (old) return old;
      props.setProperty("GEO_UAT_ACTIVATION_SECRET","generated-uat-signing-secret");
      return "generated-uat-signing-secret";
    },
    throwUatError_:(status,message)=>{throw Object.assign(new Error(message),{status});},
    String,
  };
  vm.createContext(ctx);
  vm.runInContext(main.slice(start,end),ctx);
  return {run:()=>ctx.uatEnsureFirstLoginSecrets_(store),props,credentials,setCount,calls};
}

test("valid first-use UAT login initializes absent secrets once only",()=>{
  const d=setup();
  d.run();
  assert.equal(d.props.getProperty("GEO_UAT_PASSWORD_PEPPER"),"generated-uat-pepper");
  assert.equal(d.props.getProperty("GEO_UAT_ACTIVATION_SECRET"),"generated-uat-signing-secret");
  d.run();
  assert.equal(d.setCount.GEO_UAT_PASSWORD_PEPPER,1);
  assert.equal(d.setCount.GEO_UAT_ACTIVATION_SECRET,1);
  assert.equal(d.calls.table,1);
});

test("never rotate existing pepper or signing secret during login",()=>{
  const d=setup({pepper:"unchanged-original-pepper",secret:"unchanged-original-signing-key",
    hashes:["hmac-sha256-v1$0000$opaque"]});
  d.run();
  assert.equal(d.props.getProperty("GEO_UAT_PASSWORD_PEPPER"),"unchanged-original-pepper");
  assert.equal(d.props.getProperty("GEO_UAT_ACTIVATION_SECRET"),"unchanged-original-signing-key");
  assert.deepEqual(d.setCount,{});
  assert.equal(d.calls.table,0);
});

test("fail closed and never manufacture new pepper if any password hashes exist",()=>{
  const d=setup({hashes:["hmac-sha256-v1$0000$opaque"]});
  assert.throws(()=>d.run(),e=>e.status===503 && /original UAT pepper/.test(e.message));
  assert.equal(d.props.getProperty("GEO_UAT_PASSWORD_PEPPER"),"");
  assert.equal(d.props.getProperty("GEO_UAT_ACTIVATION_SECRET"),"");
  assert.deepEqual(d.setCount,{});
});

test("inactive UAT migration or Production cannot bootstrap authentication secrets",()=>{
  for(const cfg of [{env:"PRODUCTION"},{env:"UAT",flag:"false"},{env:"DEV"}]) {
    const d=setup(cfg);
    assert.throws(()=>d.run(),e=>e.status===503);
    assert.deepEqual(d.setCount,{});
  }
});

test("login helper is called only on authenticated temporary-password setup path",()=>{
  const login = main.slice(main.indexOf("function uatLogin_(store, body) {"),
    main.indexOf("function denyUatLogin_("));
  const passwordVerified = login.indexOf("!(needsSetup ? uatTemporaryPasswordMatches_(credential, password)");
  const secretPreparation = login.indexOf("uatEnsureFirstLoginSecrets_(store);");
  const issuance = login.indexOf("uatTemporarySetupTicket_(");
  assert.ok(passwordVerified !== -1 && secretPreparation > passwordVerified &&
    issuance > secretPreparation, "verified credential precedes one-time bootstrap and ticket");
  assert.match(login,/if \(needsSetup\) \{\s*\/\/[\s\S]*?uatEnsureFirstLoginSecrets_\(store\);/);
  assert.doesNotMatch(main.slice(main.indexOf("function serve_("),main.indexOf("function json_(")),
    /GEO_UAT_PASSWORD_PEPPER/);
});
