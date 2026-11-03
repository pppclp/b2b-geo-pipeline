import test from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../server/core.js";
import { workingWithStartByTeam, livePipelineAlertState } from "../server/livePipelineAlerts.js";
import { overdueReasons } from "../src/lib/overdueSummary.js";

const now = new Date("2026-11-03T10:00:00.000Z");
const ago = days => new Date(now.getTime() - days * 86400000).toISOString();
const teams = [
  { team_id: "WW001", team_name: "Pre-sales", sla_days: 5 },
  { team_id: "WW002", team_name: "Pricer", sla_days: 5 },
];
const event = (opportunity_id, field_name, previous_value, new_value, day, event_id = "EV1") => ({
  opportunity_id, field_name, previous_value, new_value, event_at: ago(day), event_id,
});

test("per-team clocks replay persisted Change Log for add, unchanged, remove and re-add", () => {
  const op = { id: "O1", working_with_team_ids: "WW001,WW002",
    working_with_id: "WW001", working_with_since: ago(11) };
  const events = [
    event("O1", "working_with_teams", "", "WW001", 11, "E1"),
    event("O1", "working_with_teams", "WW001", "WW001,WW002", 8, "E2"),
    event("O1", "working_with_teams", "WW001,WW002", "WW001", 6, "E3"),
    event("O1", "working_with_teams", "WW001", "WW001,WW002", 3, "E4"),
  ];
  assert.deepEqual(workingWithStartByTeam(op, events, teams), {
    WW001: ago(11), WW002: ago(3),
  });
  const alert = livePipelineAlertState({ ...op, status:"Open", handler_since:ago(2),
    current_handler_id:"AE1", stage_id:"S1", stage_entered_at:ago(10) }, {
    teams, users:[{user_id:"AE1",role:"AE"}],
    stages:[{stage_id:"S1",sla_days:7}],
    settings:{handler_ae_sla_days:5,internal_task_sla_days:5},
    teamStarts:workingWithStartByTeam(op,events,teams), now,
  });
  assert.equal(alert.stageSla,true);
  assert.equal(alert.handler,null);
  assert.deepEqual(alert.workingWithTeams.map(t=>t.id),["WW001"]);
});

test("unknown historical secondary-team start is never inferred from creation date", () => {
  const op={id:"OLD",created_date:ago(100),working_with_team_ids:"WW001,WW002",
    working_with_id:"WW001",working_with_since:ago(10)};
  const actual=workingWithStartByTeam(op,[],teams);
  assert.deepEqual(actual,{WW001:ago(10)});
  assert.deepEqual(livePipelineAlertState({ ...op,status:"Won" },{
    teams,teamStarts:actual,settings:{internal_task_sla_days:5},now,
  }).workingWithTeams,[]);
});

function liveBackend() {
  const files={
    "Org.xlsx":{sheets:{
      Users:{entity:"users",primary_key:"user_id",permissions:{read:["AE","Admin"]}},
    }},
    "Config.xlsx":{sheets:{
      Stages:{entity:"stages",primary_key:"stage_id",permissions:{read:["AE","Admin"]}},
      Working_With:{entity:"working_with_options",primary_key:"team_id",permissions:{read:["AE","Admin"]}},
      Aging_Settings:{entity:"pipeline_settings",primary_key:"setting_id",permissions:{read:["AE","Admin"]}},
    }},
    "B2B_GEO_Pipeline_DB.xlsx":{sheets:{
      Pipelines:{entity:"opportunities",primary_key:"opportunity_id",scoped:true,permissions:{read:["AE","Admin"]}},
      Pipeline_Events:{entity:"opportunity_events",primary_key:"event_id",scoped:true,append_only:true,
        permissions:{read:["AE","Admin"]}},
    }},
  };
  const access={files,scope:{AE:"own",Admin:"all"},demo_as_allowed_for:[]};
  const storage={};
  for(const [file,book] of Object.entries(files))
    for(const sheet of Object.keys(book.sheets))storage[file+"|"+sheet]={headers:[],rows:[]};
  storage["Org.xlsx|Users"].rows=[
    {user_id:"ADMIN",role:"Admin",status:"Active"},
    {user_id:"AE1",role:"AE",status:"Active"},
    {user_id:"AE2",role:"AE",status:"Active"},
    {user_id:"SM1",role:"SM",status:"Active"},
  ];
  storage["Config.xlsx|Stages"].rows=[{stage_id:"S1",stage_name:"Stage 1",sla_days:7,active:"Yes"}];
  storage["Config.xlsx|Working_With"].rows=teams;
  storage["Config.xlsx|Aging_Settings"].rows=[{setting_id:"A1",threshold_days:14,active:"Yes",
    handler_ae_sla_days:5,handler_sm_sla_days:5,internal_task_sla_days:5}];
  const pipeline = (id,owner,handler,status,working) => ({
    opportunity_id:id,region_id:"R1",owner_user_id:owner,
    current_handler_user_id:handler,status,
    stage_id:"S1",stage_entered_at:ago(10),handler_since:ago(8),
    working_with_team_ids:working,working_with_id:"WW001",
    working_with_since:ago(10),created_at:ago(12),
  });
  storage["B2B_GEO_Pipeline_DB.xlsx|Pipelines"].rows=[
    pipeline("O1","AE1","SM1","Open","WW001,WW002"),
    pipeline("O2","AE2","AE2","Open","WW001"),
    pipeline("O3","AE1","AE1","Won","WW001"),
  ];
  storage["B2B_GEO_Pipeline_DB.xlsx|Pipeline_Events"].rows=[
    event("O1","working_with_teams","","WW001",10,"E1"),
    event("O1","working_with_teams","WW001","WW001,WW002",2,"E2"),
  ];
  const store={
    table:(file,sheet)=>storage[file+"|"+sheet],
    touch:()=>{throw Error("SLA read must not write any Sheet");},
  };
  const core=createCore({contract:{access,columns:{}},store,now:()=>now.toISOString(),
    uuid:()=>{throw Error("read should not create UUID");}});
  return { storage,call:(userId)=>core.handle({userId,method:"GET",path:"entities/Opportunity"}) };
}

test("authenticated live backend returns alerts for ALL authorized Pipelines, sourced from masters and events",()=>{
  const x=liveBackend();
  const before=JSON.stringify(x.storage);
  const all=x.call("ADMIN");
  assert.equal(all.length,3);
  const one=all.find(o=>o.id==="O1");
  assert.equal(one.alert_state.version,1);
  assert.equal(one.alert_state.stageSla,true);
  assert.equal(one.alert_state.handler.role,"sm");
  assert.deepEqual(one.alert_state.workingWithTeams.map(t=>t.name),["Pre-sales"]);
  assert.deepEqual(one.working_with_team_since,{WW001:ago(10),WW002:ago(2)});
  const second=all.find(o=>o.id==="O2");
  assert.equal(second.alert_state.handler.role,"ae");
  assert.equal(second.alert_state.workingWithTeams.length,1);
  const closed=all.find(o=>o.id==="O3");
  assert.equal(closed.alert_state.stageSla,false);
  assert.equal(closed.alert_state.handler,null);
  assert.deepEqual(closed.alert_state.workingWithTeams,[]);
  assert.deepEqual(x.call("AE1").map(o=>o.id).sort(),["O1","O3"]);
  assert.deepEqual(x.call("AE2").map(o=>o.id),["O2"]);
  assert.equal(JSON.stringify(x.storage),before,"alerts must not mutate Pipeline or Change Log");
  const reasons=overdueReasons(one,{S1:{sla_days:7}},7,[],{now,
    members:{SM1:{app_role:"sm"}},teams:[],config:{}});
  assert.ok(reasons.stageSla && reasons.handler && reasons.workingWithTeams.length===1);
  assert.equal(reasons.any,true,"one Pipeline counted once despite multiple tags");
});
