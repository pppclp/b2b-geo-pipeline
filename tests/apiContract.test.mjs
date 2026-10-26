import test from "node:test";
import assert from "node:assert/strict";
import {validateApiContract,API_CONTRACT_VERSION,REQUIRED_CAPABILITIES} from "../src/lib/apiContract.js";
test("matching API contract is allowed",()=>{
  const me={id:"U1",api_contract_version:API_CONTRACT_VERSION,capabilities:[...REQUIRED_CAPABILITIES]};
  assert.equal(validateApiContract(me),me);
});
test("missing, stale, or incomplete API contracts fail closed before loading Pipeline",()=>{
  for(const me of [{id:"U1"},{api_contract_version:API_CONTRACT_VERSION-1,capabilities:[...REQUIRED_CAPABILITIES]},
    {api_contract_version:API_CONTRACT_VERSION,capabilities:[]}]) {
    assert.throws(()=>validateApiContract(me),e=>e.status===503&&e.code==="API_CONTRACT_MISMATCH");
  }
});

test("older v2 backends without Sales Code import lookup are rejected before loading data",()=>{
  const oldBackend={ id:"U1",api_contract_version:API_CONTRACT_VERSION,
    capabilities:["pipeline_revision","needs_support_toggle","schema_fail_closed","import_batch_dedupe"] };
  assert.throws(()=>validateApiContract(oldBackend),
    error=>error.code==="API_CONTRACT_MISMATCH"&&error.status===503);
  assert.ok(REQUIRED_CAPABILITIES.includes("legacy_import_owner_resolution"));
});
