import test from "node:test";
import assert from "node:assert/strict";
import { handlerSlaAlert, workingWithSlaAlerts } from "../src/lib/alertRules.js";
import { overdueReasons } from "../src/lib/overdueSummary.js";

const now = new Date("2026-11-03T12:00:00.000Z");
const daysAgo = days => new Date(now.getTime() - days * 86400000).toISOString();
const teams = [
  { id: "WW001", name: "Pre-sales", sla_days: 5 },
  { id: "WW002", name: "Pricer", sla_days: 10 },
];
const config = { handler_ae_sla_days: 5, handler_sm_sla_days: 8, internal_task_sla_days: 5 };
const base = {
  id: "OPP1", status: "open", stage_id: "STG001",
  stage_entered_at: daysAgo(9), current_handler_id: "USR1", handler_since: daysAgo(7),
  working_with_team_ids: "WW001,WW002", working_with_primary_id: "WW001",
  working_with_since: daysAgo(8), working_with_team_since: { WW001: daysAgo(8), WW002: daysAgo(4) },
};
const context = { now, config, teams, members: { USR1: { app_role: "ae" } } };

test("Stage SLA, AE handler, and individual team overdue coexist without duplicate pipeline counting", () => {
  const out = overdueReasons(base, { STG001: { sla_days: 7 } }, 7, [], context);
  assert.equal(out.stageSla, true);
  assert.equal(out.handler.role, "ae");
  assert.equal(out.handler.overdueDays, 2);
  assert.deepEqual(out.workingWithTeams.map(x => x.id), ["WW001"]);
  assert.equal(out.workingWithTeams[0].overdueDays, 3);
  assert.equal(out.any, true);
});

test("Stage Aging is informational; even >7 days alone does not enter Overdue", () => {
  const op = { ...base, stage_id: "STG003", handler_since: daysAgo(1),
    working_with_team_ids: "", working_with_primary_id: "", working_with_since: "", working_with_team_since: {} };
  const out = overdueReasons(op, { STG003: { sla_days: "" } }, 7, [], context);
  assert.equal(out.stageAging, true);
  assert.equal(out.stageSla, false);
  assert.equal(out.any, false);
});

test("Handler threshold is independent for AE and SM with strict greater-than check", () => {
  assert.ok(handlerSlaAlert(base, { USR1: { app_role: "ae" } }, config, now));
  assert.equal(handlerSlaAlert(base, { USR1: { app_role: "sm" } }, config, now), null);
  assert.equal(handlerSlaAlert({ ...base, handler_since: daysAgo(5) },
    { USR1: { app_role: "ae" } }, config, now), null);
});

test("Per-team limits and independent clocks do not inherit primary team age", () => {
  const out = workingWithSlaAlerts(base, teams, 5, now);
  assert.deepEqual(out.map(x => x.name), ["Pre-sales"]);
  const unknownClock = { ...base, working_with_team_since: { WW001: daysAgo(8) },
    working_with_team_ids: "WW002", working_with_primary_id: "WW001" };
  assert.deepEqual(workingWithSlaAlerts(unknownClock, [{ id: "WW002", name: "Pricer", sla_days: 5 }], 5, now), []);
});

test("Fallback Working With SLA and historical primary team timestamp remain compatible", () => {
  const legacy = { ...base, working_with_team_ids: "", working_with_team_since: {},
    working_with_primary_id: "WW001", working_with_since: daysAgo(6) };
  const result = workingWithSlaAlerts(legacy, [{ id: "WW001", name: "Pre-sales", sla_days: null }], 5, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].overdueDays, 1);
  assert.deepEqual(workingWithSlaAlerts({ ...legacy, status: "won" }, teams, 5, now), []);
});

test("Unknown handler timestamps, roles, or Won status do not create false alarms", () => {
  assert.equal(handlerSlaAlert({ ...base, handler_since: "" }, context.members, config, now), null);
  assert.equal(handlerSlaAlert({ ...base, status: "won" }, context.members, config, now), null);
  assert.equal(handlerSlaAlert(base, { USR1: { app_role: "management" } }, config, now), null);
});

