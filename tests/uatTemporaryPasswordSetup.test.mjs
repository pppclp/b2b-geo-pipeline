import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import { createUatTemporaryPasswordSetup } from "../server/uatTemporaryPasswordSetup.js";

const BASE = Date.parse("2026-10-27T00:00:00.000Z");
const PASS = "Personal-Unique-Passphrase-492!";
function sample() {
  let tick = BASE;
  const env = {
    GEO_ENVIRONMENT:"UAT", GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED:"true",
    GEO_UAT_ACTIVATION_SECRET:"synthetic-legacy-setup-secret-long-enough",
    GEO_UAT_PASSWORD_PEPPER:"synthetic-legacy-password-pepper-long-enough",
  };
  const user = {user_id:"USR-X",employee_id:"90000999",email:"person@example.org",
    status:"Active",role:"AE",display_name:"Synthetic"};
  const cred = {user_id:"USR-X","employee_id / username":"90000999",
    temporary_password:"synthetic-temp-17",password_hash:"",
    credential_status:"",activation_code_hash:"",activation_expires_at:"",
    activation_used_at:"",password_set_at:"",password_changed_at:""};
  const store = {
    writes:0, table(_file,sheet){return {rows:sheet==="Users"?[user]:[cred]};},
    touch(){this.writes++;},
  };
  const auth = createUatTemporaryPasswordSetup({env,clock:()=>tick});
  return {user,cred,store,auth,env,advance:ms=>{tick+=ms}};
}
test("temporary password gives a setup ticket, never an application session; completion is one use",()=>{
  const a=sample();
  const started=a.auth.login(a.store,"90000999","synthetic-temp-17");
  assert.equal(started.password_setup_required,true);
  assert.equal(started.session_token,undefined);
  assert.equal(a.store.writes,0);
  const completed=a.auth.complete(a.store,started.password_setup_ticket,PASS,PASS);
  assert.deepEqual(completed,{password_set:true});
  assert.equal(a.cred.temporary_password,"");
  assert.ok(a.cred.password_hash.startsWith("hmac-sha256-v1$"));
  assert.equal(a.cred.credential_status,"active");
  assert.ok(a.cred.password_set_at);
  assert.equal(a.store.writes,1);
  assert.throws(()=>a.auth.complete(a.store,started.password_setup_ticket,PASS,PASS),{status:401});
  assert.throws(()=>a.auth.login(a.store,"90000999","synthetic-temp-17"),{status:401});
  assert.equal(a.auth.login(a.store,"90000999",PASS).user_id,"USR-X");
});
test("expired, forged, reused and wrong credentials fail closed",()=>{
  const a=sample();
  assert.throws(()=>a.auth.login(a.store,"90000999","wrong"),{status:401});
  const t=a.auth.login(a.store,"90000999","synthetic-temp-17").password_setup_ticket;
  assert.throws(()=>a.auth.complete(a.store,t+"invalid",PASS,PASS),{status:401});
  a.advance(601000);
  assert.throws(()=>a.auth.complete(a.store,t,PASS,PASS),{status:401});
  assert.equal(a.store.writes,0);
});
test("inactive, disabled, mismatched identity and feature flag off never issue setup access",()=>{
  const a=sample();
  a.user.status="Inactive";
  assert.throws(()=>a.auth.login(a.store,"90000999","synthetic-temp-17"),{status:401});
  a.user.status="Active";a.cred.credential_status="disabled";
  assert.throws(()=>a.auth.login(a.store,"90000999","synthetic-temp-17"),{status:401});
  a.cred.credential_status="";a.cred.user_id="WRONG";
  assert.throws(()=>a.auth.login(a.store,"90000999","synthetic-temp-17"),{status:401});
  a.cred.user_id="USR-X";a.env.GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED="false";
  assert.throws(()=>a.auth.login(a.store,"90000999","synthetic-temp-17"),{status:503});
});
test("new password policy is enforced and the temporary value cannot be reused",()=>{
  const a=sample(), ticket=a.auth.login(a.store,"90000999","synthetic-temp-17").password_setup_ticket;
  assert.throws(()=>a.auth.complete(a.store,ticket,"short","short"),{status:400});
  assert.throws(()=>a.auth.complete(a.store,ticket,PASS,"not the same"),{status:400});
  assert.throws(()=>a.auth.complete(a.store,ticket,"90000999-synthetic-password","90000999-synthetic-password"),{status:400});
  assert.throws(()=>a.auth.complete(a.store,ticket,"synthetic-temp-17","synthetic-temp-17"),{status:400});
  assert.equal(a.cred.temporary_password,"synthetic-temp-17");
  assert.equal(a.store.writes,0);
});
test("pre-provisioned hashed temporary credentials also require personal password setup",()=>{
  const a=sample(),salt="00112233445566778899aabbccddeeff";
  a.cred.password_hash="hmac-sha256-v1$"+salt+"$"+
    crypto.createHmac("sha256",a.env.GEO_UAT_PASSWORD_PEPPER).update(salt+":synthetic-temp-17").digest("base64url");
  a.cred.temporary_password="";
  const t=a.auth.login(a.store,"90000999","synthetic-temp-17");
  assert.equal(t.password_setup_required,true);
  assert.deepEqual(a.auth.complete(a.store,t.password_setup_ticket,PASS,PASS),{password_set:true});
});
test("actual GAS temporary setup functions enforce ticket purpose and current account state",()=>{
  const source=fs.readFileSync(new URL("../apps-script/Main.js",import.meta.url),"utf8");
  const begin=source.indexOf("// ---- UAT first-login password setup");
  const end=source.indexOf("// ---- Opt-in UAT Corporate Email Activation",begin);
  assert.ok(begin>=0 && end>begin);
  let now=BASE;
  const props=new Map([
    ["GEO_ENVIRONMENT","UAT"],["GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED","true"],
    ["GEO_UAT_ACTIVATION_SECRET","synthetic-legacy-setup-secret-long-enough"],
    ["GEO_UAT_PASSWORD_PEPPER","synthetic-legacy-password-pepper-long-enough"],
  ]);
  const a=sample();
  const ctx={
    Date:class extends Date {static now(){return now;}}, String,Number,JSON,
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key)||""})},
    Utilities:{
      DigestAlgorithm:{SHA_256:"SHA_256"},getUuid:()=>crypto.randomUUID(),
      computeHmacSha256Signature:(value,key)=>[...crypto.createHmac("sha256",key).update(value).digest()],
      base64EncodeWebSafe:b=>Buffer.from(b).toString("base64url"),
      base64DecodeWebSafe:v=>[...Buffer.from(v,"base64url")],
      newBlob:b=>({getBytes:()=>[...Buffer.from(b)],getDataAsString:()=>Buffer.from(b).toString("utf8")}),
    },
    sessionB64_:b=>Buffer.from(b).toString("base64url"),
    normalizeEmployeeId_:v=>String(v||"").trim(),
    normalizeUatCorporateEmail_:v=>String(v||"").trim().toLowerCase(),
    uatActivationSecret_:()=>props.get("GEO_UAT_ACTIVATION_SECRET"),
    uatConstantTimeEqual_:(x,y)=>String(x)===String(y),
    uatCheckNewPassword_:x=>{if(String(x).length<15)throw Object.assign(new Error("too short"),{status:400});return x;},
    uatPasswordPepper_:()=>props.get("GEO_UAT_PASSWORD_PEPPER"),
    uatPasswordDigest_:(salt,pw)=>crypto.createHmac("sha256",props.get("GEO_UAT_PASSWORD_PEPPER")).update(salt+":"+pw).digest("base64url"),
    verifyUatPassword_:(c,pw)=>{
      const v=String(c.password_hash).split("$");return v.length===3&&v[2]===crypto.createHmac("sha256",props.get("GEO_UAT_PASSWORD_PEPPER")).update(v[1]+":"+pw).digest("base64url");
    },
    GEO_UAT_PASSWORD_HASH_SCHEME_:"hmac-sha256-v1",
    throwUatError_:(status,message)=>{throw Object.assign(new Error(message),{status});},
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(begin,end),ctx);
  const t=ctx.uatTemporarySetupTicket_(a.user.user_id,a.cred);
  assert.ok(t && !t.includes("synthetic-temp"));
  assert.equal(ctx.uatReadTemporarySetupTicket_(t).typ,"uat_temp_setup");
  const output=ctx.completeUatTemporaryPasswordSetup_(a.store,{
    password_setup_ticket:t,new_password:PASS,confirm_password:PASS,
  });
  assert.equal(output.password_set,true);
  assert.equal(a.cred.temporary_password,"");
  assert.equal(a.store.writes,1);
  assert.throws(()=>ctx.completeUatTemporaryPasswordSetup_(a.store,{
    password_setup_ticket:t,new_password:PASS,confirm_password:PASS,
  }),e=>e.status===401);
  now+=601000;
  assert.throws(()=>ctx.uatReadTemporarySetupTicket_(t),e=>e.status===401);
  assert.match(source,/var passwordSetupResult = completeUatTemporaryPasswordSetup_\(store, req\.body \|\| \{\}\);[\s\S]*?store\.flush\(\);\s*return passwordSetupResult;/);
  assert.match(source,/if \(needsSetup\) \{[\s\S]*?password_setup_required: true/);
});
