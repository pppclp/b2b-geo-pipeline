import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const core = fs.readFileSync(new URL("../server/core.js", import.meta.url), "utf8");
const gas = fs.readFileSync(new URL("../apps-script/Main.js", import.meta.url), "utf8");

test("Pipeline Events retain actor_name in the API while storage projects optional legacy fields", () => {
  const block = core.slice(core.indexOf("function appendAudit("), core.indexOf("function captureSnapshot("));
  assert.match(block,/actor_name: actor\.real\.name/);
  assert.match(gas,/t\.rows\.slice\(before\.rows\.length\)\.forEach\(function \(row\) \{ delete row\.actor_name; \}\)/);
});

test("GAS rejects unknown audit columns before changing live append-only headers", () => {
  const write = gas.slice(gas.indexOf("SheetStore_.prototype.writeDirty_ ="),gas.indexOf("SheetStore_.prototype.flush ="));
  assert.match(write,/if \(protectedAudit\) \{[\s\S]*?AUDIT_SCHEMA_MISMATCH/);
  assert.match(write,/\} else \{[\s\S]*?t\.rows\.forEach/);
});

test("GAS gives separate error codes for backup failure and table write failure",()=>{
  assert.match(gas,/PIPELINE_BACKUP_FAILED/);
  assert.match(gas,/PIPELINE_WRITE_" \+ String\(d\.sheet\)/);
  assert.match(gas,/function debugGeoWriteReadiness\(\)/);
});
