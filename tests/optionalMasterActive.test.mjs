import test from "node:test";
import assert from "node:assert/strict";
import { toUi } from "../server/entities.js";

const optionalMasters = [
  ["Scenario", "scenario_id", "scenario_name"],
  ["LostReason", "reason_id", "reason_name"],
  ["WorkingWithOption", "team_id", "team_name"],
  ["SupportType", "support_type_id", "support_type_name"],
];

for (const [entity, pk, nameColumn] of optionalMasters) {
  test(`${entity} without an active column remains selectable`, () => {
    assert.equal(toUi(entity, pk, { [pk]: "X1", [nameColumn]: "Sample" }).active, true);
    assert.equal(toUi(entity, pk, { [pk]: "X1", [nameColumn]: "Sample", active: "" }).active, true);
    assert.equal(toUi(entity, pk, { [pk]: "X1", [nameColumn]: "Sample", active: "No" }).active, false);
    assert.equal(toUi(entity, pk, { [pk]: "X1", [nameColumn]: "Sample", active: "Yes" }).active, true);
  });
}

test("Entities with explicitly defined active remain fail-closed when missing", () => {
  assert.equal(toUi("Stage", "stage_id", { stage_id: "S1", stage_name: "Start" }).active, false);
}
