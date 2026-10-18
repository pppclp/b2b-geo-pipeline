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
test("History API is read-only and Snapshot API is controlled",()=>{
  assert.deepEqual(db.Pipeline_Events.permissions.create,[]);
  assert.deepEqual(db.Pipeline_Events.permissions.update,[]);
  assert.deepEqual(db.Snapshots.permissions.delete,[]);
  assert.deepEqual(db.Snapshots.permissions.create,["Admin"]);
});
