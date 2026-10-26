import test from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../server/core.js";

const fakeFiles = {
  "org.xlsx": { sheets: {
    Users: { entity: "users", primary_key: "user_id", permissions: { read: ["AE", "SM", "Management", "Admin"] } },
    User_Region: { entity: "user_regions", primary_key: "user_region_id", permissions: { read: ["AE", "SM", "Management", "Admin"] } },
    Regions: { entity: "regions", primary_key: "region_id", permissions: { read: ["AE", "SM", "Management", "Admin"] } },
  }},
  "pipeline.xlsx": { sheets: {
    Pipelines: { entity: "opportunities", primary_key: "opportunity_id", scoped: true,
      permissions: { read: ["AE", "SM", "Management", "Admin"] } },
  }},
};
function makeCore() {
  const tables = {
    "org.xlsx/Users": [
      { user_id: "AE1", role: "AE", status: "Active", display_name: "AE 1" },
      { user_id: "AE2", role: "AE", status: "Active", display_name: "AE 2" },
      { user_id: "SM1", role: "SM", status: "Active", display_name: "SM 1" },
      { user_id: "MGMT1", role: "Management", status: "Active", display_name: "Nationwide Management" },
      { user_id: "INACTIVE_MGMT", role: "Management", status: "Inactive", display_name: "Inactive Management" },
      { user_id: "ADMIN1", role: "Admin", status: "Active", display_name: "Admin 1" },
    ],
    "org.xlsx/Regions": [
      { region_id: "R1", region_name: "Region One", active: "Yes" },
      { region_id: "R2", region_name: "Region Two", active: "Yes" },
      { region_id: "INACTIVE", region_name: "Inactive Region", active: "No" },
    ],
    "org.xlsx/User_Region": [
      { user_id: "AE1", region_id: "R1", active: "Yes" },
      { user_id: "AE2", region_id: "R2", active: "Yes" },
      { user_id: "SM1", region_id: "R1", active: "Yes" },
    ],
    "pipeline.xlsx/Pipelines": [
      { opportunity_id: "OPP1", owner_user_id: "AE1", current_handler_user_id: "AE1", region_id: "R1", status: "Open" },
      { opportunity_id: "OPP2", owner_user_id: "AE2", current_handler_user_id: "AE2", region_id: "R2", status: "Open" },
    ],
  };
  const store = {
    table(file, sheet) { return { rows: tables[file + "/" + sheet] || [], headers: [] }; },
    touch() {},
  };
  const contract = {
    access: { files: fakeFiles, scope: { AE: "own", SM: "region", Management: "all", Admin: "all" }, demo_as_allowed_for: ["Admin"] },
    columns: {},
  };
  return createCore({ contract, store, now: () => "2026-10-18T10:00:00Z", uuid: () => "12345678" });
}
test("case-insensitive YAML roles enforce AE / SM / Admin read permission", () => {
  const core = makeCore();
  const list = (userId) => core.handle({ method: "GET", path: "entities/Opportunity", userId });
  assert.deepEqual(list("AE1").map((o) => o.id), ["OPP1"]);
  assert.deepEqual(list("SM1").map((o) => o.id), ["OPP1"]);
  assert.deepEqual(list("ADMIN1").map((o) => o.id), ["OPP1", "OPP2"]);
  assert.deepEqual(list("MGMT1").map((o) => o.id), ["OPP1", "OPP2"]);
});
test("non-admin cannot switch roles by sending demoAs", () => {
  const core = makeCore();
  const seen = core.handle({ method: "GET", path: "entities/Opportunity", userId: "AE1", demoAs: "ADMIN1" });
  assert.deepEqual(seen.map((o) => o.id), ["OPP1"]);
});
test("admin demoAs uses target account permission scope", () => {
  const core = makeCore();
  const seen = core.handle({ method: "GET", path: "entities/Opportunity", userId: "ADMIN1", demoAs: "AE2" });
  assert.deepEqual(seen.map((o) => o.id), ["OPP2"]);
});
