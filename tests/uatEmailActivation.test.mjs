import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createUatEmailAuth } from "../server/uatEmailActivation.js";

const BASE = Date.parse("2026-10-27T00:00:00.000Z");
const make = (changes = {}, opt = {}) => {
  let at = BASE;
  const env = {
    GEO_ENVIRONMENT: "UAT",
    GEO_UAT_EMAIL_ACTIVATION_ENABLED: "true",
    GEO_UAT_EMAIL_LOGIN_ENABLED: "true",
    GEO_UAT_ALLOWED_EMAIL_DOMAINS: "truecorp.co.th",
    GEO_UAT_ACTIVATION_SECRET: "activation-secret-that-is-strong-enough",
    GEO_UAT_PASSWORD_PEPPER: "test-only-pepper-at-least-32-characters",
    ...opt,
  };
  const records = [
    { user_id:"USR1", employee_id:"90000111", display_name:"Synthetic User", email:"synthetic@truecorp.co.th",
      role:"AE", status:"Active", ...changes },
  ];
  const cred = { user_id:"USR1", "employee_id / username":"90000111", temporary_password:"legacy-only-secret",
    password_hash:"",credential_status:"pending_activation",activation_code_hash:"",activation_expires_at:new Date(BASE+86400000).toISOString(),
    activation_used_at:"",password_set_at:"",password_changed_at:"",password_hash_version:"" };
  const store = {
    touched:[],
    table(file,sheet){return {rows:sheet==="Users"?records:[cred]};},
    touch(file,sheet){this.touched.push([file,sheet]);},
  };
  const auth = createUatEmailAuth({env,clock:()=>at});
  cred.activation_code_hash = auth.codeDigest("one-time-synthetic-code");
  return {auth,cred,records,store,env,now:ms=>{at=ms}};
};
const password="Different-Strong-Password-7294";

test("UAT activation requires a pending account and one-use token; never creates an app session",()=>{
  const a=make();
  const response=a.auth.verify(a.store,"Synthetic@TRUECORP.CO.TH","one-time-synthetic-code");
  assert.ok(response.activation_ticket);
  assert.equal(response.session_token,undefined);
  assert.equal(response.expires_in_seconds,600);
  const done=a.auth.complete(a.store,response.activation_ticket,password,password);
  assert.deepEqual(done,{activated:true});
  assert.equal(a.cred.credential_status,"active");
  assert.equal(a.cred.temporary_password,"");
  assert.equal(a.cred.activation_code_hash,"");
  assert.ok(a.cred.password_set_at);
  assert.ok(a.cred.password_hash.startsWith("hmac-sha256-v1$"));
  assert.doesNotMatch(a.cred.password_hash,/Different-Strong/);
  assert.equal(a.auth.login(a.store,"synthetic@truecorp.co.th",password).user_id,"USR1");
  assert.throws(()=>a.auth.login(a.store,"synthetic@truecorp.co.th","legacy-only-secret"),{status:401});
  assert.throws(()=>a.auth.complete(a.store,response.activation_ticket,password,password),{status:401});
});
test("activation rejects invalid code, wrong domain, duplicate email and inactive users",()=>{
  const a=make();
  assert.throws(()=>a.auth.verify(a.store,"synthetic@truecorp.co.th","wrong"),{status:401});
  assert.throws(()=>a.auth.verify(a.store,"synthetic@example.com","one-time-synthetic-code"),{status:401});
  a.records.push({...a.records[0],user_id:"USR2"});
  assert.throws(()=>a.auth.verify(a.store,"synthetic@truecorp.co.th","one-time-synthetic-code"),{status:401});
  a.records.pop();
  a.records[0].status="Inactive";
  assert.throws(()=>a.auth.verify(a.store,"synthetic@truecorp.co.th","one-time-synthetic-code"),{status:401});
});
test("credential Employee ID must match its User Master identity even if user_id matches",()=>{
 const a=make();
 a.cred["employee_id / username"]="90000002";
 assert.throws(()=>a.auth.verify(a.store,"synthetic@truecorp.co.th","one-time-synthetic-code"),{status:401});
});
test("duplicate email on inactive account must also fail closed",()=>{
 const a=make();
 a.records.push({...a.records[0],user_id:"INACTIVE2",status:"Inactive"});
 assert.throws(()=>a.auth.verify(a.store,"synthetic@truecorp.co.th","one-time-synthetic-code"),{status:401});
});
test("changes to employee binding or mailbox after verification invalidate the ticket",()=>{
 const a=make();
 const ticket=a.auth.verify(a.store,"synthetic@truecorp.co.th","one-time-synthetic-code").activation_ticket;
 a.cred["employee_id / username"]="WRONG";
 assert.throws(()=>a.auth.complete(a.store,ticket,password,password),{status:401});
 assert.equal(a.cred.credential_status,"pending_activation");
});
test("no activation after expiry; short-lived ticket cannot be replayed or tampered",()=>{
  const a=make();
  const ticket=a.auth.verify(a.store,"synthetic@truecorp.co.th","one-time-synthetic-code").activation_ticket;
  assert.throws(()=>a.auth.complete(a.store,ticket+"tampered",password,password),{status:401});
  a.now(BASE+601000);
  assert.throws(()=>a.auth.complete(a.store,ticket,password,password),{status:401});
  a.now(BASE+86400001);
  assert.throws(()=>a.auth.verify(a.store,"synthetic@truecorp.co.th","one-time-synthetic-code"),{status:401});
});
test("UAT activation/login feature switches default closed",()=>{
  const a=make({},{
    GEO_UAT_EMAIL_ACTIVATION_ENABLED:"false",GEO_UAT_EMAIL_LOGIN_ENABLED:"false",
  });
  assert.throws(()=>a.auth.verify(a.store,"synthetic@truecorp.co.th","one-time-synthetic-code"),{status:503});
  assert.throws(()=>a.auth.login(a.store,"synthetic@truecorp.co.th",password),{status:503});
});
test("new password policy and explicit confirmation are server-enforced",()=>{
  const a=make();
  const ticket=a.auth.verify(a.store,"synthetic@truecorp.co.th","one-time-synthetic-code").activation_ticket;
  assert.throws(()=>a.auth.complete(a.store,ticket,"short","short"),{status:400});
  assert.throws(()=>a.auth.complete(a.store,ticket,password,"mismatch"),{status:400});
  assert.equal(a.cred.credential_status,"pending_activation");
  assert.equal(a.store.touched.length,0);
});
test("Apps Script requires editor provisioning, one-time code and no Login Session in activation",()=>{
  const gas=readFileSync(new URL("../apps-script/Main.js",import.meta.url),"utf8");
  assert.match(gas,/function verifyUatActivation_\(/);
  assert.match(gas,/function completeUatActivation_\(/);
  assert.match(gas,/function issueUatActivationCode\(/);
  assert.match(gas,/GEO_UAT_EMAIL_ACTIVATION_ENABLED/);
  assert.match(gas,/GEO_UAT_ALLOWED_EMAIL_DOMAINS/);
  assert.match(gas,/c\.activation_code_hash = ""/);
  assert.match(gas,/return \{ activated: true \}/);
});
