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

test("Contracted Lost_Reasons without an active column remain selectable",()=>{
  const contractedReasons=[{reason_id:"LR003",reason_name:"Cancel"}];
  const v=normalizeClosureUpdate({status:"lost",lost_reason_id:"LR003"},current,contractedReasons,actorId,stamp);
  assert.equal(v.lost_reason_id,"LR003");
  assert.equal(v.status,"lost");
});
test("Blank optional active is allowed, but explicitly inactive is denied",()=>{
  const optionalReasons=[
    {reason_id:"BLANK",reason_name:"Cancel",active:""},
    {reason_id:"INACTIVE",reason_name:"Other",active:"No"},
  ];
  assert.equal(normalizeClosureUpdate({status:"lost",lost_reason_id:"BLANK"},current,optionalReasons,actorId,stamp).status,"lost");
  assert.throws(()=>normalizeClosureUpdate({status:"lost",lost_reason_id:"INACTIVE"},current,optionalReasons,actorId,stamp),/Lost Reason/);
  assert.throws(()=>normalizeClosureUpdate({status:"lost",lost_reason_id:"MISSING"},current,optionalReasons,actorId,stamp),/Lost Reason/);
});
