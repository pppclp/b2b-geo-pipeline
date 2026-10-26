import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

// Synthetic vectors only. This proves the Node and Apps Script implementations
// use the same HMAC message, key and base64url encoding. It does NOT certify
// the HMAC password scheme as a production-grade password KDF.
const gas = fs.readFileSync(new URL("../apps-script/Main.js", import.meta.url), "utf8");
const passwordPepper = "synthetic-uat-password-pepper-only-1234567890";
const activationSecret = "synthetic-activation-signing-secret-1234567890";
const digest = (key, value) => crypto.createHmac("sha256", key).update(value, "utf8").digest("base64url");

function gasFunction(name, env) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = gas.match(new RegExp("function " + escaped + "\\([^)]*\\)\\s*\\{[\\s\\S]*?^\\}", "m"));
  assert.ok(match, "Missing Apps Script function " + name);
  return vm.runInNewContext(match[0] + "\\n" + name, env);
}
const Utilities = {
  computeHmacSha256Signature: (message, key) => Array.from(
    crypto.createHmac("sha256", key).update(String(message), "utf8").digest()),
  base64EncodeWebSafe: bytes => Buffer.from(bytes).toString("base64url"),
};
const context = {
  Utilities, GEO_UAT_PASSWORD_HASH_SCHEME_: "hmac-sha256-v1",
  uatPasswordPepper_: () => passwordPepper,
  uatActivationSecret_: () => activationSecret,
  sessionB64_: bytes => Buffer.from(bytes).toString("base64url"),
};

test("Node and Apps Script UAT password HMAC use identical synthetic vectors", () => {
  const gasHash = gasFunction("uatPasswordDigest_", context);
  const samples = [
    ["0123456789abcdef0123456789abcdef", "synthetic-password-123456"],
    ["00000000000000000000000000000000", "รหัสผ่านทดสอบเท่านั้น123456789"],
  ];
  for (const [salt, password] of samples) {
    assert.equal(gasHash(salt, password), digest(passwordPepper, salt + ":" + password));
  }
});

test("Node and Apps Script activation code HMAC use identical synthetic vectors", () => {
  const gasHash = gasFunction("uatActivationDigest_", context);
  const code = "synTHETIC-CODE-NO-EMPLOYEE-DATA-98765";
  assert.equal(gasHash(code), digest(activationSecret, "activate:" + code));
});

test("GAS activation persists under ScriptLock before advertising success", () => {
  assert.match(gas, /function handle_\(req\)[\s\S]*?var lock = LockService\.getScriptLock\(\);[\s\S]*?lock\.waitLock\(30000\)/);
  assert.match(gas, /var activationResult = completeUatActivation_\(store, req\.body \|\| \{\}\);[\s\S]*?store\.flush\(\);\s*return activationResult;/);
  assert.match(gas, /c\.activation_used_at = now;[\s\S]*?c\.activation_code_hash = "";/);
  assert.match(gas, /function completeUatActivation_\([\s\S]*?return \{ activated: true \};/);
});

test("UAT email-activation and plaintext gates are opt-in and never inferred from domain", () => {
  assert.match(gas, /function uatActivationEnabled_\(\)[\s\S]*?getProperty\("GEO_ENVIRONMENT"\) === "UAT"[\s\S]*?GEO_UAT_EMAIL_ACTIVATION_ENABLED/);
  assert.match(gas, /function uatCorporateDomainAllowed_\(email\)/);
  assert.match(gas, /GEO_UAT_ALLOWED_EMAIL_DOMAINS/);
  assert.match(gas, /function geoUatTemporaryPasswordWindowOpen_\(\)/);
});
