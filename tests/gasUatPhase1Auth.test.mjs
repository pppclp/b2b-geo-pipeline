import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {createHash,createHmac} from "node:crypto";

// Run the real Apps Script UAT login functions with emulated GAS services;
// avoids a production spreadsheet write and tests the same authentication logic.
const source = fs.readFileSync(new URL("../apps-script/Main.js", import.meta.url), "utf8");
const start = source.indexOf("function uatLogin_(");
const end = source.indexOf("// UAT signed sessions:", start);
assert.ok(start >= 0 && end > start, "UAT function block must remain extractable");

function fixture(credentials, users = [{employee_id:"90001",user_id:"U0001",status:"Active",role:"AE"}]) {
  const cacheValues = new Map();
  const properties = new Map();
  const cache = {
    get: (k) => cacheValues.get(k) ?? null,
    put: (k, v) => cacheValues.set(k, v),
    remove: (k) => cacheValues.delete(k),
  };
  const ctx = {
    CacheService: {getScriptCache:()=>cache},
    console: {warn:()=>{}, log:()=>{}},
    PropertiesService: {getScriptProperties:()=>({
      getProperty:k=>properties.get(k)??null,
      setProperty:(k,v)=>properties.set(k,v),
      deleteProperty:(k)=>properties.delete(k)
    })},
    Utilities: {
      DigestAlgorithm:{SHA_256:"SHA_256"},
      computeDigest:(_alg,x)=>[...createHash("sha256").update(x).digest()],
      computeHmacSha256Signature:(s,key)=>[...createHmac("sha256",key).update(s).digest()],
      base64EncodeWebSafe:(bytes)=>Buffer.from(bytes).toString("base64url"),
      getUuid:()=> "12345678-1234-1234-1234-123456789abc",
    },
    sessionB64_:(bytes)=>Buffer.from(bytes).toString("base64url"),
    normalizeEmployeeId_:(v)=>String(v??"").trim(),
    throwUatError_:(status,message)=>{const e=new Error(message);e.status=status;throw e;},
    issueUatSession_:id=>`session-${id}`,
    LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start,end),ctx);
  const store={table:(file,sheet)=>{
    if(sheet==="Users")return {rows:users};
    if(sheet==="UAT_Credentials")return {rows:credentials};
    throw Error("Unexpected sheet "+sheet);
  }};
  return {ctx,cacheValues,properties,store};
}

test("plaintext login fails closed unless migration window is explicitly enabled",()=>{
  const {ctx,store,properties}=fixture([{"employee_id / username":"90001",temporary_password:"good"}]);
  assert.throws(()=>ctx.uatLogin_(store,{username:"90001",password:"good"}),e=>e.status===401);
  properties.set("GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS","true");
  assert.throws(()=>ctx.uatLogin_(store,{username:"90001",password:"good"}),e=>e.status===401);
  properties.set("GEO_ENVIRONMENT","UAT");
  assert.equal(ctx.uatLogin_(store,{username:"90001",password:"good"}).user_id,"U0001");
  assert.throws(()=>ctx.uatLogin_(store,{username:"90001",password:"wrong"}),e=>e.status===401);
});

test("aggregate password spraying is alerted, not a global account lockout",()=>{
  const {ctx,store,cacheValues,properties}=fixture([{"employee_id / username":"90001",temporary_password:"good"}]);
  for(let i=0;i<50;i++) {
    assert.throws(()=>ctx.uatLogin_(store,{username:String(100000+i),password:"bad"}),e=>e.status===401);
  }
  assert.equal(cacheValues.get("GEO_LOGIN_FAIL_GLOBAL_V1"),"50");
  assert.equal(cacheValues.get("GEO_LOGIN_SPRAY_ALERT_V1"),"1");
  properties.set("GEO_ENVIRONMENT","UAT");
  properties.set("GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS","true");
  assert.equal(ctx.uatLogin_(store,{username:"90001",password:"good"}).user_id,"U0001");
});

test("hashed credentials win over plaintext and compare against the protected pepper",()=>{
  const cred={"employee_id / username":"90001",temporary_password:"insecure-old-value"};
  const {ctx,properties,store}=fixture([cred]);
  properties.set("GEO_UAT_PASSWORD_PEPPER","test-server-only-pepper");
  const salt="a".repeat(32);
  cred.password_hash="hmac-sha256-v1$"+salt+"$"+ctx.uatPasswordDigest_(salt,"secure-password");
  assert.equal(ctx.uatLogin_(store,{username:"90001",password:"secure-password"}).user_id,"U0001");
  assert.throws(()=>ctx.uatLogin_(store,{username:"90001",password:"insecure-old-value"}),e=>e.status===401);
});

test("plaintext login is blocked once migration is sealed",()=>{
  const {ctx,properties,store}=fixture([{"employee_id / username":"90001",temporary_password:"good"}]);
  properties.set("GEO_UAT_REQUIRE_HASHED_PASSWORDS","true");
  assert.throws(()=>ctx.uatLogin_(store,{username:"90001",password:"good"}),e=>e.status===401);
});

test("migration cannot run without explicit approval property",()=>{
  const {ctx}=fixture([]);
  assert.throws(()=>ctx.migrateUatCredentialsToSaltedHashes(),/take a restricted backup/);
});

test("UAT plaintext window blocks production environment and expires on schedule",()=>{
  const {ctx,properties,store}=fixture([{"employee_id / username":"90001",temporary_password:"good"}]);
  properties.set("GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS","true");
  properties.set("GEO_ENVIRONMENT","UAT");
  properties.set("GEO_UAT_TEMP_PASSWORD_EXPIRES_AT",new Date(Date.now()-60_000).toISOString());
  assert.throws(()=>ctx.uatLogin_(store,{username:"90001",password:"good"}),e=>e.status===401);
  properties.set("GEO_UAT_TEMP_PASSWORD_EXPIRES_AT",new Date(Date.now()+60_000).toISOString());
  assert.equal(ctx.uatLogin_(store,{username:"90001",password:"good"}).user_id,"U0001");
  properties.set("GEO_ENVIRONMENT","PRODUCTION");
  assert.throws(()=>ctx.uatLogin_(store,{username:"90001",password:"good"}),e=>e.status===503);
});

test("manual temporary-login recovery needs UAT and explicit approval and clears it",()=>{
  const {ctx,properties}=fixture([]);
  assert.throws(()=>ctx.enableUatTemporaryLoginFor14Days(),/UAT recovery not approved/);
  properties.set("GEO_ENVIRONMENT","UAT");
  assert.throws(()=>ctx.enableUatTemporaryLoginFor14Days(),/UAT recovery not approved/);
  properties.set("GEO_UAT_TEMP_LOGIN_APPROVED","YES");
  ctx.debugUatLoginReadiness=()=>({
    active_users:3, credential_ready:2, missing_employee_id:1,
    missing_credential_record:0, missing_password:0, duplicate_credential_ids:0
  });
  const result=ctx.enableUatTemporaryLoginFor14Days();
  assert.equal(result.enabled,true);
  assert.equal(result.credential_ready,2);
  assert.equal(properties.get("GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS"),"true");
  assert.ok(Date.parse(properties.get("GEO_UAT_TEMP_PASSWORD_EXPIRES_AT"))>Date.now());
  assert.equal(properties.has("GEO_UAT_TEMP_LOGIN_APPROVED"),false);
  assert.equal(ctx.disableUatTemporaryLogin().enabled,false);
  assert.equal(properties.has("GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS"),false);
});

test("manual recovery never downgrades hashed-password-only mode",()=>{
  const {ctx,properties}=fixture([]);
  properties.set("GEO_ENVIRONMENT","UAT");
  properties.set("GEO_UAT_TEMP_LOGIN_APPROVED","YES");
  properties.set("GEO_UAT_REQUIRE_HASHED_PASSWORDS","true");
  assert.throws(()=>ctx.enableUatTemporaryLoginFor14Days(),/do not downgrade/);
  assert.equal(properties.has("GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS"),false);
});

test("one active user and one correctly bound credential can sign in", () => {
  const {ctx,store,properties}=fixture([{
    user_id:"U0001", "employee_id / username":"90001",temporary_password:"good"
  }]);
  properties.set("GEO_ENVIRONMENT","UAT");
  properties.set("GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS","true");
  assert.equal(ctx.uatLogin_(store,{username:"90001",password:"good"}).user_id,"U0001");
});

test("duplicate active Employee IDs cannot choose another account or privileged role", () => {
  const users=[
    {employee_id:"90001",user_id:"U0001",status:"Active",role:"AE"},
    {employee_id:"90001",user_id:"ADMIN1",status:"Active",role:"Admin"}
  ];
  const {ctx,store,properties}=fixture([
    {user_id:"U0001","employee_id / username":"90001",temporary_password:"good"}
  ],users);
  properties.set("GEO_ENVIRONMENT","UAT");
  properties.set("GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS","true");
  assert.throws(()=>ctx.uatLogin_(store,{username:"90001",password:"good"}),e=>e.status===401);
});

test("duplicate credential rows never authenticate by the first matching password", () => {
  const {ctx,store,properties}=fixture([
    {user_id:"U0001","employee_id / username":"90001",temporary_password:"good"},
    {user_id:"ADMIN1","employee_id / username":"90001",temporary_password:"other"}
  ]);
  properties.set("GEO_ENVIRONMENT","UAT");
  properties.set("GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS","true");
  assert.throws(()=>ctx.uatLogin_(store,{username:"90001",password:"good"}),e=>e.status===401);
});

test("a credential bound to a different user_id cannot unlock another identity", () => {
  const {ctx,store,properties}=fixture([
    {user_id:"ADMIN1","employee_id / username":"90001",temporary_password:"good"}
  ]);
  properties.set("GEO_ENVIRONMENT","UAT");
  properties.set("GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS","true");
  assert.throws(()=>ctx.uatLogin_(store,{username:"90001",password:"good"}),e=>e.status===401);
});

test("inactive user login is blocked even if password matches", () => {
  const {ctx,store,properties}=fixture([
    {user_id:"U0001","employee_id / username":"90001",temporary_password:"good"}
  ], [{employee_id:"90001",user_id:"U0001",status:"Inactive",role:"AE"}]);
  properties.set("GEO_ENVIRONMENT","UAT");
  properties.set("GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS","true");
  assert.throws(()=>ctx.uatLogin_(store,{username:"90001",password:"good"}),e=>e.status===401);
});

test("read-only login readiness reports identity ambiguity without exposing credentials", () => {
  const users=[
    {employee_id:"90001",user_id:"U0001",status:"Active",role:"AE"},
    {employee_id:"90001",user_id:"ADMIN1",status:"Active",role:"Admin"},
    {employee_id:"90002",user_id:"U0002",status:"Active",role:"SM"}
  ];
  const credentials=[
    {user_id:"U0001","employee_id / username":"90001",temporary_password:"secret-1"},
    {user_id:"NOT-U0002","employee_id / username":"90002",password_hash:"hmac-sha256-v1$synthetic"}
  ];
  const {ctx,store}=fixture(credentials,users);
  ctx.SheetStore_ = function () { return store; };
  const summary=ctx.debugUatLoginReadiness();
  assert.equal(summary.duplicate_user_employee_ids,1);
  assert.equal(summary.credential_user_id_mismatch,3);
  assert.equal(summary.credential_ready,0);
  assert.equal(JSON.stringify(summary).includes("secret-1"),false);
  assert.equal(JSON.stringify(summary).includes("NOT-U0002"),false);
});
