import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadContract } from "../server/contract.js";

const read = p => readFileSync(new URL(p, import.meta.url), "utf8");
const contract = loadContract(new URL("../b2b_geo_pipeline.yaml", import.meta.url));

test("Management has nationwide contract scope while AE and SM remain restricted", () => {
  assert.equal(contract.access.scope.Management, "all");
  assert.equal(contract.access.scope.Admin, "all");
  assert.equal(contract.access.scope.SM, "region");
  assert.equal(contract.access.scope.AE, "own");
});

test("Backend derives Management Region list from active Region Master, not User_Region", () => {
  const core = read("../server/core.js");
  assert.match(core, /role === "management"\s*\? rows\("regions"\)\.filter\(\(r\) => isActive\(r\.active\)\)/);
  assert.match(core, /if \(scope === "all"\) return \(\) => true;/);
  assert.match(core, /if \(\["admin", "management"\]\.includes\(actor\.role\)/);
  assert.match(core, /if \(actor\?\.role === "ae"\) throw new HttpError\(403/);
});

test("Dashboard and Pipeline expose all active Region quick filters for Management", () => {
  const dashboard = read("../src/pages/Dashboard.jsx");
  const pipeline = read("../src/pages/Pipeline.jsx");
  const bar = read("../src/components/FilterBar.jsx");
  assert.match(dashboard, /isAdmin \|\| isManagement \|\| \(profile\?\.region_ids/);
  assert.match(pipeline, /\["admin", "management"\]\.includes\(profile\?\.app_role\)/);
  assert.match(bar, /\["admin","management"\]\.includes\(profile\?\.app_role\)/);
});

test("Client Pipeline filtering does not hide Server-authorized Management rows", () => {
  const data = read("../src/lib/dataContext.jsx");
  assert.match(data, /profile\.app_role === "management"\) \{[\s\S]*?return true;/);
  assert.match(data, /profile\.app_role === "sm"\) \{[\s\S]*?profile\.region_ids/);
});

test("Management may select an AE from any Region while SM remains Region-limited", () => {
  const creation = read("../src/components/CreatePipelineModal.jsx");
  assert.match(creation, /const nationwideRole = \["admin", "management"\]\.includes\(profile\?\.app_role\);/);
  assert.match(creation, /const allowedOwnerRegions = nationwideRole \? regionIds/);
  assert.match(creation, /nationwideRole \|\|[\s\S]*?\.some\(\(id\) => \(profile\?\.region_ids/);
  const admin = read("../src/pages/Admin.jsx");
  assert.match(admin, /All Regions \(by role\)/);
  assert.match(admin, /No manual Region mapping is required/);
});
