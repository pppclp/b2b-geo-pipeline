import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const VISIBLE_FILES=[
  "src/pages/Login.jsx",
  "src/pages/SetTemporaryPassword.jsx",
  "src/pages/ActivateAccount.jsx",
  "src/components/AppLayout.jsx",
  "src/components/DemoAsBar.jsx",
  "src/lib/actionFeedback.js",
  "src/lib/apiContract.js",
  "src/api/client.js",
  "src/lib/AuthContext.jsx",
];

test("user-facing labels and string literals never say UAT",()=>{
  for(const path of VISIBLE_FILES){
    const source=readFileSync(new URL("../"+path,import.meta.url),"utf8");
    assert.doesNotMatch(source,/["'`][^"'\n]*UAT[^"'\n]*["'`]/,
      path+" must not expose internal rollout wording to users");
    assert.doesNotMatch(source,/>\s*UAT\b/,path);
  }
});
test("all active password input screens enforce ten, not fifteen, characters",()=>{
  for(const path of ["src/pages/ActivateAccount.jsx","src/pages/SetTemporaryPassword.jsx"]){
    const source=readFileSync(new URL("../"+path,import.meta.url),"utf8");
    assert.match(source,/minLength=\{10\}/);
    assert.doesNotMatch(source,/minLength=\{15\}|15[–-]128|password\.length < 15/);
  }
});
test("login failures do not falsely claim a wrong password when backend may have a binding error",()=>{
  const login=readFileSync(new URL("../src/pages/Login.jsx",import.meta.url),"utf8");
  assert.match(login,/Sign-in could not be verified/);
  assert.doesNotMatch(login,/password is incorrect/);
});
