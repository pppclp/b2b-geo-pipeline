import test from "node:test";
import assert from "node:assert/strict";
import {filterSupportRequests,supportQueueCounts} from "../src/lib/supportQueue.js";

const requests=[
 {request_id:"A",status:"Open",assigned_to_user_id:""},
 {request_id:"B",status:"In Progress",assigned_to_user_id:"M1"},
 {request_id:"C",status:"Open",assigned_to_user_id:"M2"},
 {request_id:"D",status:"Resolved",assigned_to_user_id:""},
];
test("unassigned Triage includes only active, ownerless requests",()=>{
 assert.deepEqual(filterSupportRequests(requests,"unassigned","M1").map(r=>r.request_id),["A"]);
 assert.deepEqual(filterSupportRequests(requests,"mine","M1").map(r=>r.request_id),["B"]);
 assert.deepEqual(filterSupportRequests(requests,"active").map(r=>r.request_id),["A","B","C"]);
 assert.deepEqual(filterSupportRequests(requests,"resolved").map(r=>r.request_id),["D"]);
 assert.deepEqual(supportQueueCounts(requests,"M1"),{unassigned:1,mine:1,active:3,resolved:1,all:4});
});
