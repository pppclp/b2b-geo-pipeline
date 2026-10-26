import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const src=fs.readFileSync(new URL("../apps-script/Main.js",import.meta.url),"utf8");
const start=src.indexOf("function uatEnsureFirstLoginSecrets_(");
const end=src.indexOf("// ---- UAT first-login password setup",start);
assert.ok(start>0&&end>start);
const fn=src.slice(start,end);
test("UAT secret bootstrap is invoked only after verified temporary credential",()=>{
 const login=src.slice(src.indexOf("function uatLogin_("),src.indexOf("function denyUatLogin_("));
 assert.match(login,/if \(needsSetup\) \{\s*\/\/ First-use secret initialization[\s\S]*?uatEnsureFirstLoginSecrets_\(store\)/);
 assert.ok(login.indexOf("verifyUatPassword_")<login.indexOf("uatEnsureFirstLoginSecrets_"));
});
test("UAT bootstrap preserves existing pepper, refuses rotation with stored hashes, and creates absent ticket key",()=>{
 const p=new Map();let pepperCreates=0,keyCreates=0;
 const creds=[{password_hash:""}];
 const ctx={uatTemporarySetupEnabled_:()=>true,PropertiesService:{getScriptProperties:()=>({getProperty:k=>p.get(k)||""})},
 GEO_UAT_PASSWORD_PEPPER_PROPERTY_:"PEPPER",uatPasswordPepper_:()=>{pepperCreates++;p.set("PEPPER","generated");},
 uatActivationSecret_:()=>{keyCreates++;},throwUatError_:(status,msg)=>{const e=new Error(msg);e.status=status;throw e;}};
 const store={table:()=>({rows:creds})};
 const vm=requireVM();vm.createContext(ctx);vm.runInContext(fn,ctx);
 ctx.uatEnsureFirstLoginSecrets_(store);assert.equal(pepperCreates,1);assert.equal(keyCreates,1);
 ctx.uatEnsureFirstLoginSecrets_(store);assert.equal(pepperCreates,1);assert.equal(keyCreates,2);
 p.delete("PEPPER");creds[0].password_hash="stored-hash";
 assert.throws(()=>ctx.uatEnsureFirstLoginSecrets_(store),e=>e.status===503);
 assert.equal(pepperCreates,1);
});
function requireVM(){return vmModule;}
import vmModule from "node:vm";
