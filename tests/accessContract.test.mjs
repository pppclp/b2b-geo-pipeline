import test from "node:test";
import assert from "node:assert/strict";
import { loadContract } from "../server/contract.js";

const contract=loadContract(new URL("../b2b_geo_pipeline.yaml",import.meta.url));
const db=contract.access.files["B2B_GEO_Pipeline_DB.xlsx"].sheets;

test("production YAML allows Management create/update and AE scoped export",()=>{
  assert.ok(db.Pipelines.permissions.create.includes("Management"));
  assert.ok(db.Pipelines.permissions.update.includes("Management"));
  assert.ok(db.Pipelines.permissions.export.includes("AE"));
});
test("UAT credentials contract preserves legacy columns and appends activation fields",()=>{
  assert.deepEqual(contract.columns.uat_credentials,[
    "user_id","employee_id / username","temporary_password","password_hash",
    "credential_status","activation_code_hash","activation_expires_at",
    "activation_used_at","password_set_at","password_changed_at","password_hash_version"
  ]);
  assert.deepEqual(contract.access.files["B2B_GEO_UAT_Credentials_Distribution.xlsx"].sheets.UAT_Credentials.permissions.read,[]);
});

test("History API is read-only and Snapshot API is controlled",()=>{
  assert.deepEqual(db.Pipeline_Events.permissions.create,[]);
  assert.deepEqual(db.Pipeline_Events.permissions.update,[]);
  assert.deepEqual(db.Snapshots.permissions.delete,[]);
  assert.deepEqual(db.Snapshots.permissions.create,["Admin"]);
});
