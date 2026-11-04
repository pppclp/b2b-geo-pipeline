import test from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../server/core.js";
import { buildSnapshotRows } from "../server/snapshot.js";

function fixture() {
  const access = {
    files: {
      "Org.xlsx": { sheets: {
        Users: { entity:"users", primary_key:"user_id", permissions:{ read:["AE","SM","Management","Admin"] } },
        User_Region: { entity:"user_regions", primary_key:"user_region_id",
          permissions:{read:["AE","SM","Management","Admin"]} },
      }},
      "B2B_GEO_Pipeline_DB.xlsx": { sheets: {
        Pipelines: { entity:"opportunities", primary_key:"opportunity_id", scoped:true,
          permissions:{ read:["AE","SM","Management","Admin"],
            update:["AE","SM","Management","Admin"], delete:[], export:["AE","SM","Management","Admin"] } },
        Pipeline_Events: { entity:"opportunity_events", primary_key:"event_id", scoped:true,
          append_only:true, permissions:{ read:["AE","SM","Management","Admin"],
            create:[], update:[], delete:[] } },
      }},
    },
    scope:{ AE:"own",SM:"region",Management:"all",Admin:"all" },
    demo_as_allowed_for:["Admin"],
  };
  const book = {};
  for (const [file, entry] of Object.entries(access.files))
    for (const sheet of Object.keys(entry.sheets))
      book[file+"|"+sheet] = { headers:[], rows:[] };
  book["Org.xlsx|Users"].rows = [
    { user_id:"AE1", role:"AE", status:"Active", display_name:"AE One" },
    { user_id:"AE2", role:"AE", status:"Active", display_name:"AE Two" },
    { user_id:"SM1", role:"SM", status:"Active", display_name:"SM One" },
    { user_id:"SM2", role:"SM", status:"Active", display_name:"SM Two" },
    { user_id:"MAN", role:"Management", status:"Active", display_name:"Management" },
    { user_id:"ADMIN", role:"Admin", status:"Active", display_name:"Admin" },
  ];
  book["Org.xlsx|User_Region"].rows = [
    {user_region_id:"UR1",user_id:"AE1",region_id:"R1",active:"Yes"},
    {user_region_id:"UR2",user_id:"AE2",region_id:"R2",active:"Yes"},
    {user_region_id:"UR3",user_id:"SM1",region_id:"R1",active:"Yes"},
    {user_region_id:"UR4",user_id:"SM2",region_id:"R2",active:"Yes"},
  ];
  const row=(id,region,owner,handler,status="Open")=>({
    opportunity_id:id, customer_name:"Customer "+id, region_id:region,
    owner_user_id:owner, current_handler_user_id:handler, status,
    pipeline_value:100, updated_at:"2026-11-04T08:00:00.000Z",
    created_at:"2026-11-01T08:00:00.000Z",
  });
  book["B2B_GEO_Pipeline_DB.xlsx|Pipelines"].rows = [
    row("O1","R1","AE1","AE1"), row("O2","R2","AE2","AE2"),
    row("O3","R1","AE2","AE1","Won"),
  ];
  const touched=[];
  let clock=Date.parse("2026-11-04T09:00:00.000Z");
  let uid=0;
  const store={
    table:(file,sheet)=>book[file+"|"+sheet],
    touch:(file,sheet)=>{touched.push(file+"|"+sheet);},
  };
  const core=createCore({contract:{access,columns:{}},store,
    now:()=>new Date(clock++).toISOString(),uuid:()=>String(++uid)});
  const call=(who,method,path,body)=>core.handle({userId:who,method,path,body});
  const active=()=>book["B2B_GEO_Pipeline_DB.xlsx|Pipelines"].rows;
  const events=()=>book["B2B_GEO_Pipeline_DB.xlsx|Pipeline_Events"].rows;
  return { call, active, events, touched };
}
const rev="2026-11-04T08:00:00.000Z";
const deleteData={reason:"Duplicate Pipeline entry",expected_updated_at:rev};

test("AE can soft-delete own Pipeline without removing the row or Event history",()=>{
  const x=fixture();
  const result=x.call("AE1","POST","pipeline-trash/O1/delete",deleteData);
  assert.equal(result.ok,true);
  assert.equal(x.active().length,3);
  const row=x.active().find(x=>x.opportunity_id==="O1");
  assert.equal(row.status,"Open");
  assert.equal(row.deleted_by_user_id,"AE1");
  assert.equal(row.delete_reason,deleteData.reason);
  assert.ok(row.deleted_at);
  assert.notEqual(row.updated_at,rev);
  assert.deepEqual(x.call("AE1","GET","entities/Opportunity").map(x=>x.id),["O3"]);
  assert.deepEqual(x.call("AE1","GET","exports/pipelines").map(x=>x.id),["O3"]);
  assert.equal(x.call("AE1","GET","pipeline-trash").length,1);
  assert.throws(()=>x.call("AE1","GET","entities/Opportunity/O1"),e=>e.status===404);
  assert.throws(()=>x.call("AE1","PUT","entities/Opportunity/O1",{remark:"edited",expected_updated_at:row.updated_at}),e=>e.status===409);
  assert.throws(()=>x.call("ADMIN","DELETE","entities/Opportunity/O1"),e=>e.status===405);
  assert.equal(x.events().length,1);
  assert.deepEqual(x.events().map(e=>[e.event_type,e.field_name,e.actor_user_id,e.remark]),
    [["pipeline_deleted","soft_delete","AE1",deleteData.reason]]);
  assert.ok(x.touched.includes("B2B_GEO_Pipeline_DB.xlsx|Pipelines"));
  assert.ok(x.touched.includes("B2B_GEO_Pipeline_DB.xlsx|Pipeline_Events"));
});

test("AE handler is authorized; other AE and out-of-region SM cannot delete",()=>{
  const x=fixture();
  assert.throws(()=>x.call("AE2","POST","pipeline-trash/O1/delete",deleteData),e=>e.status===403);
  assert.throws(()=>x.call("SM2","POST","pipeline-trash/O1/delete",deleteData),e=>e.status===403);
  assert.equal(x.call("AE1","POST","pipeline-trash/O3/delete",deleteData).ok,true);
  assert.deepEqual(x.call("AE1","GET","pipeline-trash").map(x=>x.id),["O3"]);
  assert.equal(x.call("SM2","GET","pipeline-trash").length,0);
  assert.equal(x.events().length,1,"Forbidden requests must not write audit");
});

test("regional SM can delete and restore a Won Pipeline without losing old status",()=>{
  const x=fixture();
  const deleted=x.call("SM1","POST","pipeline-trash/O3/delete",deleteData);
  assert.equal(deleted.ok,true);
  const deletedRow=x.active().find(r=>r.opportunity_id==="O3");
  assert.equal(deletedRow.status,"Won");
  const revision=deletedRow.updated_at;
  assert.throws(()=>x.call("SM2","POST","pipeline-trash/O3/restore",
    {reason:"Restoring legitimate opportunity",expected_updated_at:revision}),e=>e.status===403);
  const restored=x.call("SM1","POST","pipeline-trash/O3/restore",
    {reason:"Restoring legitimate opportunity",expected_updated_at:revision});
  assert.equal(restored.restored,true);
  assert.equal(deletedRow.status,"Won");
  assert.equal(deletedRow.deleted_at,"");
  assert.equal(deletedRow.deleted_by_user_id,"");
  assert.equal(deletedRow.delete_reason,"");
  assert.deepEqual(x.call("AE1","GET","entities/Opportunity").map(x=>x.id),["O1","O3"]);
  assert.equal(x.call("SM1","GET","pipeline-trash").length,0);
  const types=x.events().map(e=>e.event_type);
  assert.deepEqual(types,["pipeline_deleted","pipeline_restored"]);
  assert.deepEqual(x.events().map(e=>e.actor_user_id),["SM1","SM1"]);
  const history=x.call("SM1","GET","entities/OpportunityHistory");
  assert.equal(history.length,2);
  assert.ok(history.every(e=>e.actor_name==="SM One"));
});

test("reason and exact revision are mandatory; invalid actions are read-only",()=>{
  const x=fixture();
  const before=JSON.stringify(x.active());
  for (const body of [
    {reason:"x",expected_updated_at:rev},
    {reason:"Duplicate",expected_updated_at:"bad-revision"},
    {reason:"Duplicate"},
  ]) assert.throws(()=>x.call("AE1","POST","pipeline-trash/O1/delete",body),
    e=>[400,409,428].includes(e.status));
  assert.equal(JSON.stringify(x.active()),before);
  assert.equal(x.events().length,0);
  x.call("AE1","POST","pipeline-trash/O1/delete",deleteData);
  assert.throws(()=>x.call("AE1","POST","pipeline-trash/O1/delete",deleteData),e=>e.status===409);
  assert.equal(x.events().length,1);
});

test("soft-deleted Pipelines do not enter future snapshots; existing history stays untouched",()=>{
  const x=fixture();
  const beforeRows=x.active().map(r=>({...r}));
  x.call("AE1","POST","pipeline-trash/O1/delete",deleteData);
  const rows=buildSnapshotRows(x.active(),"2026-11","2026-11-30T00:00:00Z",(()=>{let i=0;return ()=>"S"+(++i);})());
  assert.deepEqual(rows.map(x=>x.opportunity_id),["O2","O3"]);
  assert.deepEqual(x.active().map(x=>x.opportunity_id),beforeRows.map(x=>x.opportunity_id));
});

test("Backend disallows direct spoofing of deletion metadata and generic hard delete",()=>{
  const x=fixture();
  assert.throws(()=>x.call("AE2","POST","pipeline-trash/O1/delete",deleteData),e=>e.status===403);
  assert.throws(()=>x.call("AE1","DELETE","entities/Opportunity/O1"),e=>e.status===405);
  assert.throws(()=>x.call("ADMIN","DELETE","entities/Opportunity/O1"),e=>e.status===405);
  assert.equal(x.events().length,0);
  assert.equal(x.active().length,3);
});
