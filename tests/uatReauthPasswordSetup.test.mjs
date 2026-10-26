import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const auth = readFileSync(new URL("../src/lib/AuthContext.jsx", import.meta.url), "utf8");
const backend = readFileSync(new URL("../apps-script/Main.js", import.meta.url), "utf8");

test("expired-session modal does not unmount an unsaved Pipeline draft while the password is first set", () => {
  assert.match(auth, /login\(reauthUser\.trim\(\), reauthPassword, \{ preserveDraft: true \}\)/);
  assert.match(auth, /if \(!preserveDraft\) \{\s*setUser\(null\);\s*setIsAuthenticated\(false\);/);
  assert.match(auth, /session\.clear\(\);[\s\S]*?if \(!preserveDraft\)/);
  assert.match(auth, /setReauthStep\("setup"\)/);
  assert.match(auth, /password_setup_ticket/);
  assert.match(auth, /reauthStep === "setup" \? \(/);
  assert.match(auth, /onSubmit=\{completeReauthPasswordSetup\}/);
  assert.match(auth, /db\.temporaryPassword\.complete\(/);
  assert.match(auth, /setReauthStep\("signin"\)/);
  assert.match(auth, /setReauthStep\("login"\)/);
  assert.match(auth, /String\(account\?\.id\) !== String\(user\.id\)/);
  assert.match(auth, /{sessionExpired && isAuthenticated && \(/);
  assert.match(auth, /Your unsaved Pipeline form is still here/);
  assert.doesNotMatch(auth, /window\.location\.(?:assign|href|replace)\(.*setup-password/);
});

test("password setup tickets are handled only in React memory, not URL or persisted storage", () => {
  assert.match(auth, /setReauthSetup\(\{\s*ticket: outcome\.password_setup_ticket/);
  assert.match(auth, /reauthSetup\.ticket, reauthNewPassword, reauthConfirmPassword/);
  assert.doesNotMatch(auth, /localStorage\.setItem\(.*(?:ticket|password)/);
  assert.doesNotMatch(auth, /sessionStorage\.setItem\(.*(?:ticket|password)/);
});

test("editor-only readiness checks flag missing signing secret, pepper and workbook binding without exposing credentials", () => {
  const start = backend.indexOf("function debugUatPasswordSetupReadiness()");
  const end = backend.indexOf("// Editor-only: safely initialize secrets",start);
  assert.ok(start>=0 && end>start);
  const values = new Map([
    ["GEO_ENVIRONMENT","UAT"],
    ["GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED","true"],
    ["GEO_UAT_ACTIVATION_SECRET","redacted-secret-example"],
    ["GEO_UAT_PASSWORD_PEPPER","redacted-pepper-example"],
  ]);
  const users = [
    {user_id:"U001",employee_id:"123",status:"Active"},
    {user_id:"U002",employee_id:"",status:"Active"},
    {user_id:"U003",employee_id:"124",status:"Inactive"},
  ];
  const credentials = [
    {user_id:"U001","employee_id / username":"123",temporary_password:"private-test-value",credential_status:"",password_hash:""},
    {user_id:"U003","employee_id / username":"124",temporary_password:"private-test-value2",credential_status:"",password_hash:""},
  ];
  let printed = [];
  const ctx = {
    PropertiesService: {getScriptProperties:()=>({getProperty:key=>values.get(key)||""})},
    GEO_UAT_PASSWORD_PEPPER_PROPERTY_:"GEO_UAT_PASSWORD_PEPPER",
    sheetIdFor_:(_)=>"synthetic-id",
    SheetStore_:function() { this.table=(_file,sheet)=>({rows:sheet==="Users"?users:credentials}); },
    normalizeEmployeeId_:v=>String(v||"").trim(),
    uatTemporaryCredentialPending_:c=>!c.credential_status && !!c.temporary_password,
    console:{log:value=>printed.push(value)},
    JSON, String,
  };
  vm.createContext(ctx);
  vm.runInContext(backend.slice(start,end),ctx);
  const ok=ctx.debugUatPasswordSetupReadiness();
  assert.equal(ok.ready_for_existing_temporary_passwords,true);
  assert.equal(ok.pending_setup_accounts,1);
  assert.equal(ok.active_users_missing_employee_id,1);
  assert.equal(ok.user_count,3);
  assert.equal(ok.credentials_count,2);
  assert.ok(!printed.join("").includes("private-test-value"));
  assert.ok(!printed.join("").includes("redacted-secret-example"));
  values.delete("GEO_UAT_ACTIVATION_SECRET");
  const notReady=ctx.debugUatPasswordSetupReadiness();
  assert.equal(notReady.activation_signing_secret_present,false);
  assert.equal(notReady.ready_for_existing_temporary_passwords,false);
  assert.ok(!JSON.stringify(notReady).includes("synthetic-id"));
});

test("App Script readiness helper is not reachable as a public HTTP handler", () => {
  const route = backend.slice(backend.indexOf("function handle_(req)"),backend.indexOf("function uatLogin_("));
  assert.doesNotMatch(route,/debugUatPasswordSetupReadiness/);
  assert.match(backend,/return \{ password_setup_required: true,/);
  assert.match(backend,/function debugUatPasswordSetupReadiness\(\)/);
});
