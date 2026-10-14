import test from "node:test";
import assert from "node:assert/strict";
import { normalizeClosureUpdate } from "../server/closure.js";
const current = { id: "OPP1", status: "open", owner_id: "AE1" };
const reasons = [{reason_id:"LR001",reason_name:"Price",active:"Yes"},{reason_id:"LR002",reason_name:"Other",active:"No"}];
const actorId = "SM2", stamp="2026-10-14T08:00:00.000Z";
test("Lost requires valid active reason",()=>{
  assert.throws(()=>normalizeClosureUpdate({status:"lost"},current,reasons,actorId,stamp),/Lost Reason/);
  assert.throws(()=>normalizeClosureUpdate({status:"lost",lost_reason_id:"LR002"},current,reasons,actorId,stamp),/Lost Reason/);
  assert.throws(()=>normalizeClosureUpdate({status:"lost",lost_reason_id:"WRONG"},current,reasons,actorId,stamp),/Lost Reason/);
});
test("Valid Lost gets actor and timestamp from server",()=>{
  const v=normalizeClosureUpdate({status:"lost",lost_reason_id:"LR001",lost_note:" Price too high ",lost_by:"WRONG",lost_at:"2000-01-01"},current,reasons,actorId,stamp);
  assert.equal(v.lost_reason_id,"LR001");
  assert.equal(v.lost_note,"Price too high");
  assert.equal(v.lost_by,actorId);
  assert.equal(v.lost_at,stamp);
});
test("Won never requires a Lost Reason and uses authenticated user",()=>{
  const v=normalizeClosureUpdate({status:"won",won_by:"AE1",won_at:"2000-01-01"},current,reasons,actorId,stamp);
  assert.equal(v.won_by,actorId);
  assert.equal(v.won_at,stamp);
});
test("Non-status Stage updates do not change closure fields",()=>{
  const v=normalizeClosureUpdate({stage_id:"STG3"},current,reasons,actorId,stamp);
  assert.deepEqual(v,{stage_id:"STG3"});
});
test("Can't close already closed Pipeline",()=>{
  assert.throws(()=>normalizeClosureUpdate({status:"won"},{...current,status:"lost"},reasons,actorId,stamp),/open Pipeline/);
});
