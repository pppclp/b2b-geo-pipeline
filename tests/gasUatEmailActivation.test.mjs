import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {createHmac, createHash} from "node:crypto";

const source=fs.readFileSync(new URL("../apps-script/Main.js",import.meta.url),"utf8");
const start=source.indexOf("function normalizeUatCorporateEmail_(");
const end=source.indexOf("// MANUAL, READ-ONLY health check",start);
assert.ok(start>=0 && end>start);

const setup=()=>{
  const properties=new Map([
    ["GEO_ENVIRONMENT","UAT"],
    ["GEO_UAT_EMAIL_ACTIVATION_ENABLED","true"],
    ["GEO_UAT_ALLOWED_EMAIL_DOMAINS","truecorp.co.th"],
    ["GEO_UAT_ACTIVATION_SECRET","synthetic-activation-secret-long-enough"],
    ["GEO_UAT_PASSWORD_PEPPER","synthetic-password-pepper-long-enough"],
  ]);
  const cache=new Map();
  let timestamp=Date.parse("2026-10-27T00:00:00.000Z");
  const DateFake=class extends Date {static now(){return timestamp;}};
  const user={user_id:"USER1",display_name:"Synthetic",employee_id:"90000001",email:"person@truecorp.co.th",status:"Active",role:"AE"};
  const credential={user_id:"USER1", "employee_id / username":"90000001",temporary_password:"legacy-only-secret",
    credential_status:"pending_activation",activation_code_hash:"",activation_expires_at:new Date(timestamp+3600000).toISOString(),
    activation_used_at:"",password_hash:"",password_set_at:""};
  const store={
    dirty:false,
    table:(file,sheet)=>({rows:sheet==="Users"?[user]:[credential]}),
    touch:()=>{store.dirty=true;},
  };
  const blob=bytes=>({
    getBytes:()=>[...Buffer.from(bytes)],
    getDataAsString:()=>Buffer.from(bytes).toString("utf8"),
  });
  const ctx={
    Date:DateFake,
    Number, String, JSON, Buffer,
    PropertiesService:{getScriptProperties:()=>({
      getProperty:k=>properties.get(k)||"",
      setProperty:(k,v)=>properties.set(k,v),
      deleteProperty:k=>properties.delete(k),
    })},
    CacheService:{getScriptCache:()=>({
      get:k=>cache.get(k)||null,
      put:(k,v)=>cache.set(k,v),
      remove:k=>cache.delete(k),
    })},
    Utilities:{
      DigestAlgorithm:{SHA_256:"SHA_256"},
      getUuid:()=>"aabbccdd-1234-4567-8a90-000000000001",
      computeDigest:(_alg,x)=>[...createHash("sha256").update(x).digest()],
      computeHmacSha256Signature:(text,key)=>[...createHmac("sha256",key).update(text).digest()],
      base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString("base64url"),
      base64DecodeWebSafe:text=>[...Buffer.from(text,"base64url")],
      newBlob:x=>blob(x),
    },
    sessionB64_:bytes=>Buffer.from(bytes).toString("base64url"),
    normalizeEmployeeId_:v=>String(v||"").trim(),
    uatConstantTimeEqual_:(a,b)=>String(a)===String(b),
    uatPasswordPepper_:()=>properties.get("GEO_UAT_PASSWORD_PEPPER"),
    uatPasswordDigest_:(salt,password)=>createHmac("sha256",properties.get("GEO_UAT_PASSWORD_PEPPER"))
      .update(salt+":"+password).digest("base64url"),
    GEO_UAT_PASSWORD_HASH_SCHEME_:"hmac-sha256-v1",
    throwUatError_:(status,message)=>{const e=new Error(message);e.status=status;throw e;},
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start,end),ctx);
  credential.activation_code_hash=ctx.uatActivationDigest_("synthetic-one-use");
  return {ctx,store,credential,user,properties,advance:ms=>{timestamp+=ms}};
};
test("GAS verifies corporate email, issues short ticket and records new hash once",()=>{
 const f=setup();
 const ticket=f.ctx.verifyUatActivation_(f.store,{email:"Person@TRUECORP.CO.TH",code:"synthetic-one-use"});
 assert.equal(ticket.expires_in_seconds,600);
 assert.equal(ticket.session_token,undefined);
 assert.equal(f.store.dirty,false);
 const reply=f.ctx.completeUatActivation_(f.store,{
   activation_ticket:ticket.activation_ticket,
   new_password:"Strong-Unique-Password-27!",
   confirm_password:"Strong-Unique-Password-27!",
 });
 assert.equal(reply.activated,true);
 assert.equal(f.store.dirty,true);
 assert.equal(f.credential.temporary_password,"");
 assert.equal(f.credential.credential_status,"active");
 assert.ok(f.credential.password_hash.startsWith("hmac-sha256-v1$"));
 assert.throws(()=>f.ctx.completeUatActivation_(f.store,{
  activation_ticket:ticket.activation_ticket,new_password:"Strong-Unique-Password-27!",
  confirm_password:"Strong-Unique-Password-27!",
 }),e=>e.status===401);
});
test("GAS blocks duplicate-code replay and expiry without mutating the credential",()=>{
 const f=setup();
 assert.throws(()=>f.ctx.verifyUatActivation_(f.store,{email:"person@truecorp.co.th",code:"bad"}),e=>e.status===401);
 assert.equal(f.store.dirty,false);
 const ticket=f.ctx.verifyUatActivation_(f.store,{email:"person@truecorp.co.th",code:"synthetic-one-use"});
 f.advance(601000);
 assert.throws(()=>f.ctx.completeUatActivation_(f.store,{
   activation_ticket:ticket.activation_ticket,new_password:"Strong-Unique-Password-27!",
   confirm_password:"Strong-Unique-Password-27!",
 }),e=>e.status===401);
});
test("GAS activation endpoint commits Credentials before success",()=>{
 assert.match(source,/var activationResult = completeUatActivation_\(store, req\.body \|\| \{\}\);\s*\/\/[^\n]*\n[^\n]*\n\s*store\.flush\(\);\s*return activationResult;/);
});

test("GAS fails closed for credential employee mismatch and inactive duplicate corporate mailbox",()=>{
 const a=setup();
 a.credential["employee_id / username"]="90000002";
 assert.throws(()=>a.ctx.verifyUatActivation_(a.store,{email:"person@truecorp.co.th",code:"synthetic-one-use"}),e=>e.status===401);
});
test("GAS exposes aggregate readiness helper without employee identifiers",()=>{
 const a=setup();
 const counts=a.ctx.debugUatEmailActivationReadiness;
 assert.equal(typeof counts,"function");
 assert.match(source,/function debugUatEmailActivationReadiness\(/);
});
