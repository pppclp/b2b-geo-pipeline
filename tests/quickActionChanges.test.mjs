import test from "node:test";
import assert from "node:assert/strict";
import { buildQuickActionChanges } from "../src/lib/quickActionChanges.js";
const op = { id: "OPP1", status: "open", stage_id: "STG2", stage_entered_at: "2026-01-01", current_handler_id: "AE1", handler_since: "2026-02-01", working_with: "Pricer", working_with_since: "2026-03-01" };
const meta = { stages: [{ id:"STG1", name:"Stage 1" }, { id:"STG2", name:"Stage 2" }, { id:"STG3", name:"Stage 3" }], maps: { stage: { STG2:{name:"Stage 2"},STG3:{name:"Stage 3"} }, member: { AE1: {name:"AE One"},SM1:{name:"SM One"} } }, now: "2026-10-14T00:00:00.000Z" };
test("handler change does not reset stage timer", () => {
  const {changes,events}=buildQuickActionChanges(op,{stageId:"STG2",handlerId:"SM1",workingWith:"Pricer"},meta);
  assert.deepEqual(Object.keys(changes).sort(),["current_handler_id","handler_since"]);
  assert.equal(changes.handler_since,meta.now);
  assert.equal(events[0].event_type,"handler_change");
});
test("stage change does not reset handler timer", () => {
  const {changes,events}=buildQuickActionChanges(op,{stageId:"STG3",handlerId:"AE1",workingWith:"Pricer"},meta);
  assert.deepEqual(Object.keys(changes).sort(),["stage_entered_at","stage_id"]);
  assert.equal(events[0].event_type,"stage_change");
});
test("team change leaves stage and handler timers untouched", () => {
  const {changes,events}=buildQuickActionChanges(op,{stageId:"STG2",handlerId:"AE1",workingWith:"Product"},meta);
  assert.deepEqual(Object.keys(changes).sort(),["working_with","working_with_since"]);
  assert.equal(events[0].event_type,"working_with_change");
});
test("multiple changes produce one patch and independent history events", () => {
  const {changes,events}=buildQuickActionChanges(op,{stageId:"STG3",handlerId:"SM1",workingWith:""},meta);
  assert.deepEqual(Object.keys(changes).sort(),["current_handler_id","handler_since","stage_entered_at","stage_id","working_with","working_with_since"]);
  assert.equal(changes.working_with_since,"");
  assert.equal(events.length,3);
});
test("no change means no write; closed and invalid stage rejected", () => {
  const a=buildQuickActionChanges(op,{stageId:"STG2",handlerId:"AE1",workingWith:"Pricer"},meta);
  assert.deepEqual(a,{changes:{},events:[]});
  assert.throws(()=>buildQuickActionChanges({...op,status:"won"},{stageId:"STG3"},meta));
  assert.throws(()=>buildQuickActionChanges(op,{stageId:"BAD"},meta));
});
