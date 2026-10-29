import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildTeamActivityLog } from "../server/activityLog.js";

const opportunities = [
 { opportunity_id:"P-N1",customer_name:"Synthetic Alpha",region_id:"N" },
 { opportunity_id:"P-N2",customer_name:"Synthetic Beta",region_id:"N" },
 { opportunity_id:"P-S1",customer_name:"Synthetic Gamma",region_id:"S" },
];
const users = [
 {user_id:"AE-N",role:"AE",display_name:"AE North"},
 {user_id:"AE-S",role:"AE",display_name:"AE South"},
 {user_id:"SM-N",role:"SM",display_name:"SM North"},
 {user_id:"ADMIN",role:"Admin",display_name:"Admin User"},
];
const userRegions = [
 {user_id:"AE-N",region_id:"N",active:"Yes"},
 {user_id:"AE-S",region_id:"S",active:"Yes"},
 {user_id:"SM-N",region_id:"N",active:"Yes"},
];
const events = [
 {event_id:"E-1",opportunity_id:"P-N1",event_type:"create",actor_user_id:"AE-N",event_at:"2026-10-28T05:00:00Z"},
 {event_id:"E-2",opportunity_id:"P-N1",event_type:"stage_change",actor_user_id:"AE-N",event_at:"2026-10-28T08:00:00Z",previous_value:"Stage 1",new_value:"Stage 2"},
 {event_id:"E-3",opportunity_id:"P-N2",event_type:"handler_change",actor_user_id:"SM-N",event_at:"2026-10-28T09:00:00Z"},
 {event_id:"E-4",opportunity_id:"P-S1",event_type:"won",actor_user_id:"AE-S",event_at:"2026-10-28T09:30:00Z"},
 {event_id:"E-5",opportunity_id:"P-N1",event_type:"support_on",actor_user_id:"AE-N",event_at:"2026-10-28T09:35:00Z"},
 {event_id:"E-6",opportunity_id:"P-N1",event_type:"field_change",field_name:"support_note",actor_user_id:"AE-N",event_at:"2026-10-28T09:36:00Z"},
 {event_id:"E-7",opportunity_id:"P-N1",event_type:"field_change",field_name:"remark",actor_user_id:"ADMIN",event_at:"2026-10-28T10:00:00Z"},
];
const call = (role,filters={})=>buildTeamActivityLog({
 actor:{id:role==="sm"?"SM-N":"MGMT",role,region_ids:role==="sm"?["N"]:["N","S"]},
 opportunities, events, users, userRegions, filters,
});
test("AE has no team Activity Log access even when requesting a valid region",()=>{
 assert.throws(()=>call("ae",{region:"N"}),err=>err.status===403);
});
test("SM gets only AE writes inside both Pipeline scope and current AE region; never SM/Admin",()=>{
 const result=call("sm",{});
 assert.deepEqual(result.items.map(e=>e.id),["E-2","E-1"]);
 assert.equal(result.total,2);
 assert.deepEqual(result.people.map(p=>p.id),["AE-N"]);
 assert.deepEqual(result.regions,["N"]);
 assert.throws(()=>call("sm",{role:"sm"}),e=>e.status===403);
 assert.equal(call("sm",{actor_id:"AE-S"}).total,0);
 assert.equal(call("sm",{region:"S"}).total,0);
});
test("Management sees AE + SM over all regions, but never Admin or retired Support events",()=>{
 const data=call("management");
 assert.deepEqual(data.items.map(e=>e.id),["E-4","E-3","E-2","E-1"]);
 assert.equal(data.by_person.find(p=>p.actor_id==="AE-N").count,2);
 assert.equal(data.by_person.find(p=>p.actor_id==="AE-N").pipeline_count,1);
 assert.throws(()=>call("management",{role:"admin"}),e=>e.status===403);
});
test("Actor means the user who performed action, not the AE Pipeline owner",()=>{
 const data=call("management",{actor_id:"SM-N"});
 assert.deepEqual(data.items.map(x=>x.id),["E-3"]);
 assert.equal(data.items[0].actor_role,"sm");
});
test("Date filter uses Bangkok day; person summary is independent from page size",()=>{
 const z=call("management",{from:"2026-10-28",to:"2026-10-28",limit:"1",offset:"1"});
 assert.equal(z.total,4);
 assert.equal(z.items.length,1);
 assert.equal(z.next_offset,2);
 assert.equal(z.by_person.reduce((a,b)=>a+b.count,0),4);
 assert.throws(()=>call("management",{from:"2026-02-31"}),e=>e.status===400);
 assert.throws(()=>call("management",{limit:"999"}),e=>e.status===400);
});
test("Region, role, action and text filters restrict results; search cannot broaden scope",()=>{
 assert.equal(call("management",{region:"N",role:"ae",action:"stage_change",search:"Alpha"}).total,1);
 assert.equal(call("sm",{search:"Synthetic Gamma"}).total,0);
 assert.equal(call("management",{role:"sm",action:"handler_change"}).total,1);
});
test("Activity Log has a dedicated route and nav but Dashboard remains untouched",()=>{
 const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
 assert.match(read("src/components/AppLayout.jsx"),/role === "admin"|"admin"\]\.includes\(role\)/);
 assert.match(read("src/components/AppLayout.jsx"),/to: "\/activity-log"/);
 assert.match(read("src/App.jsx"),/Route path="\/activity-log"/);
 assert.doesNotMatch(read("src/pages/Dashboard.jsx"),/ActivityLog|Recent Activity/);
});
