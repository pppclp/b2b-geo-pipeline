import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const core = fs.readFileSync(new URL("../server/core.js", import.meta.url), "utf8");
const gas = fs.readFileSync(new URL("../apps-script/Main.js", import.meta.url), "utf8");

test("Pipeline Events keep actor attribution without appending unknown columns", () => {
  assert.match(core, /actor_user_id: actor\.real\.id,[\s\S]*?event_at: stamp,[\s\S]*?if \(table\.headers\.includes\("actor_name"\)\) row\.actor_name = actor\.real\.name;/);
  const block = core.slice(core.indexOf("function appendAudit("), core.indexOf("function captureSnapshot("));
  assert.doesNotMatch(block, /actor_name: actor\.real\.name/);
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
