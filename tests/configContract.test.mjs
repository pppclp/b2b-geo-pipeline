import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildContract } from "../server/contract.js";
import { ENTITIES, toUi, toSheet } from "../server/entities.js";

const yaml = fs.readFileSync(new URL("../b2b_geo_pipeline.yaml", import.meta.url), "utf8");
const contract = buildContract(yaml);
const file = contract.access.files["B2B_GEO_Pipeline_Config.xlsx"];

test("new SLA and dropdown masters are registered without renaming existing sheets", () => {
  for (const sheet of ["Stages","Scenarios","Lost_Reasons","Working_With","Support_Types","Aging_Settings","Stage_SLA","Action_SLA","Field_Options"]) {
    assert.ok(file.sheets[sheet],sheet);
  }
  assert.equal(file.sheets.Action_SLA.entity, ENTITIES.ActionSLA.entity);
  assert.equal(file.sheets.Stage_SLA.entity, ENTITIES.StageSLA.entity);
  assert.equal(file.sheets.Field_Options.entity, ENTITIES.FieldOption.entity);
  assert.equal(file.sheets.Scenario_Rules, undefined);
});
test("new source columns map both ways without losing optional teams", () => {
  const item = {action_sla_id:"ACT001", process_key:"P", action_name:"Price Review", step_order:1, working_with_id:"", sla_days:"", active:"Yes", day_type:"business"};
  const rec = toUi("ActionSLA","action_sla_id",item);
  assert.equal(rec.working_with_id,"");
  assert.equal(rec.sla_days,null);
  assert.equal(rec.active,true);
  const raw=toSheet("ActionSLA","action_sla_id",{sla_days:null,working_with_id:"",day_type:"business"});
  assert.equal(raw.sla_days,null);
  assert.equal(raw.working_with_id,"");
});
