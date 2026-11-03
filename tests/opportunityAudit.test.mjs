import test from "node:test";
import assert from "node:assert/strict";
import { opportunityAuditEvents } from "../server/opportunityAudit.js";
test("creation emits one backend-owned history event", () => {
  assert.deepEqual(opportunityAuditEvents(null, { opportunity_id: "OPP01", status: "Open" }).map(x => x.event_type), ["create"]);
});
test("stage and handler updated together produce independent events, not aging noise", () => {
  const before = { opportunity_id:"OPP01", stage_id:"S1", stage_entered_at:"old", current_handler_user_id:"AE1", handler_since:"old", status:"Open" };
  const after = { ...before, stage_id:"S2", stage_entered_at:"new", current_handler_user_id:"SM1", handler_since:"new", updated_at:"new" };
  assert.deepEqual(opportunityAuditEvents(before, after).map(x=>x.event_type), ["stage_change","handler_change"]);
});
test("loss reason and status are both audited, actor is not browser supplied", () => {
  const events = opportunityAuditEvents({ opportunity_id:"A",status:"Open",lost_reason_id:"" }, { opportunity_id:"A",status:"lost",lost_reason_id:"R1" });
  assert.ok(events.some(x=>x.event_type==="lost"));
  assert.ok(events.some(x=>x.field==="lost_reason_id"));
  assert.ok(events.every(x=>!("actor_user_id" in x)));
});
test("no state difference produces no event",()=>assert.equal(opportunityAuditEvents({a:1},{a:1,updated_at:"today"}).length,0));

test("Working With multi-team change is captured once in immutable Change Log", () => {
  const before = { opportunity_id:"OPP01",working_with_id:"WW001",working_with_team_ids:"WW001" };
  const after = { ...before,working_with_team_ids:"WW001,WW002",updated_at:"2026-11-03" };
  const events = opportunityAuditEvents(before,after);
  assert.deepEqual(events.map(e=>e.field),["working_with_teams"]);
  assert.equal(events[0].previous_value,"WW001");
  assert.equal(events[0].new_value,"WW001,WW002");
  assert.ok(!events.some(e=>e.field === "working_with_since"));
});
