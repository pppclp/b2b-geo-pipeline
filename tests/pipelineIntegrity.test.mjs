import test from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../server/core.js";

function fixture() {
  const access = { files: {
    "Org.xlsx": { sheets: {
      Users: { entity:"users", primary_key:"user_id", permissions:{read:["AE","Management","Admin"]} },
      User_Region: { entity:"user_regions", primary_key:"user_region_id", permissions:{read:["AE","Management","Admin"]} },
      Lost_Reasons: { entity:"lost_reasons", primary_key:"reason_id", permissions:{read:["AE","Management","Admin"]} },
    }},
    "B2B_GEO_Pipeline_DB.xlsx": { sheets: {
      Pipelines: { entity:"opportunities",primary_key:"opportunity_id",scoped:true,permissions:{
        read:["AE","Management","Admin"],create:["AE","Management","Admin"],update:["AE","Management","Admin"],delete:[],export:["AE","Management","Admin"],import:["Admin"]
      }},
      Pipeline_Events: { entity:"opportunity_events",primary_key:"event_id",scoped:true,append_only:true,permissions:{
        read:["AE","Management","Admin"],create:[],update:[],delete:[]
      }},
      Snapshots: { entity:"monthly_snapshots",primary_key:"snapshot_id",scoped:true,permissions:{
        read:["Management","Admin"],create:["Admin"],update:[],delete:[]
      }},
    }},
  },scope:{AE:"own",Management:"region",Admin:"all"},demo_as_allowed_for:["Admin"] };
  const all={};
  for(const [file,f] of Object.entries(access.files)) for(const sheet of Object.keys(f.sheets)) all[file+"|"+sheet]={headers:[],rows:[]};
  all["Org.xlsx|Users"].rows=[
    {user_id:"AE1",employee_id:"11",display_name:"Amy",role:"AE",status:"Active"},
    {user_id:"M1",employee_id:"22",display_name:"Manager",role:"Management",status:"Active"},
    {user_id:"ADMIN",employee_id:"33",display_name:"Admin",role:"Admin",status:"Active"},
  ];
  all["Org.xlsx|User_Region"].rows=[
    {user_region_id:"UR1",user_id:"AE1",region_id:"R1",active:"Yes"},
    {user_region_id:"UR2",user_id:"M1",region_id:"R1",active:"Yes"},
  ];
  all["Org.xlsx|Lost_Reasons"].rows=[{reason_id:"R1",active:"Yes",reason_name:"Price"}];
  const touched=[];
  const store={table(file,sheet){return all[file+"|"+sheet];},touch(file,sheet){touched.push(file+"|"+sheet);}};
  let n=100;
  const core=createCore({contract:{access,columns:{}},store,now:()=>"2026-10-18T12:30:00.000Z",uuid:()=>String(n++)});
  const call=(userId,method,path,body)=>{
    const actualBody = body && method==="PUT" && path.startsWith("entities/Opportunity/") &&
      body.expected_updated_at === undefined
      ? { ...body, expected_updated_at: String(store.table("B2B_GEO_Pipeline_DB.xlsx","Pipelines").rows.find((r)=>String(r.opportunity_id)===decodeURIComponent(path.slice("entities/Opportunity/".length)))?.updated_at || "") }
      : body;
    return core.handle({userId,method,path,body:actualBody});
  };
  return {call,all,touched};
}
const newPipeline={customer_name:"Shop",business_id:"123",customer_type:"SME",contact_name:"Jane",contact_phone:"111",sales_channel:"AE Self",
  product_category_id:"CAT1",expected_close_month:"2026-11",owner_id:"AE1",current_handler_id:"AE1",region_id:"R1",status:"open",quantity:1,price_per_sub:100,client_request_id:"integrity_req_000001"};

test("Management can create a Pipeline with a single authoritative audit entry",()=>{
  const x=fixture();const result=x.call("M1","POST","entities/Opportunity",newPipeline);
  assert.equal(result.owner_id,"AE1");
  assert.equal(result._audit_events.length,1);
  assert.equal(x.all["B2B_GEO_Pipeline_DB.xlsx|Pipeline_Events"].rows.length,1);
  const event=x.all["B2B_GEO_Pipeline_DB.xlsx|Pipeline_Events"].rows[0];
  assert.equal(event.actor_user_id,"M1");
  assert.equal(event.event_type,"create");
  assert.ok(x.touched.includes("B2B_GEO_Pipeline_DB.xlsx|Pipelines"));
  assert.ok(x.touched.includes("B2B_GEO_Pipeline_DB.xlsx|Pipeline_Events"));
  assert.throws(()=>x.call("AE1","POST","entities/OpportunityHistory",{ opportunity_id:result.id,event_type:"fake" }),e=>e.status===403);
});
test("one Pipeline update generates stage/handler events in the same request",()=>{
  const x=fixture(), o=x.call("M1","POST","entities/Opportunity",newPipeline);
  const updated=x.call("M1","PUT","entities/Opportunity/"+o.id,{ stage_id:"S2",stage_entered_at:"today",current_handler_id:"M1",handler_since:"today",audit_remark:"handoff" });
  assert.deepEqual(updated._audit_events.map(e=>e.event_type).sort(),["handler_change","stage_change"]);
  assert.ok(updated._audit_events.every(e=>e.actor_id==="M1"));
  assert.equal(x.all["B2B_GEO_Pipeline_DB.xlsx|Pipeline_Events"].rows.length,3);
  assert.equal("audit_remark" in x.all["B2B_GEO_Pipeline_DB.xlsx|Pipelines"].rows[0],false);
});
test("Admin snapshot recapture replaces a month without touching other months",()=>{
  const x=fixture(),o=x.call("M1","POST","entities/Opportunity",newPipeline);
  assert.throws(()=>x.call("AE1","POST","snapshots/capture",{snapshot_period:"2026-10"}),e=>e.status===403);
  assert.equal(x.call("ADMIN","POST","snapshots/capture",{snapshot_period:"2026-09"}).captured,1);
  x.call("ADMIN","POST","snapshots/capture",{snapshot_period:"2026-10"});
  const updated=x.call("M1","PUT","entities/Opportunity/"+o.id,{price_per_sub:200});
  assert.equal(updated.pipeline_value,200);
  x.call("ADMIN","POST","snapshots/capture",{snapshot_period:"2026-10"});
  const snaps=x.all["B2B_GEO_Pipeline_DB.xlsx|Snapshots"].rows;
  assert.equal(snaps.length,2);
  assert.equal(snaps.find(s=>s.snapshot_period==="2026-09").pipeline_value,100);
  assert.equal(snaps.find(s=>s.snapshot_period==="2026-10").pipeline_value,200);
  assert.equal(new Set(snaps.map(s=>s.snapshot_id)).size,2);
  assert.throws(()=>x.call("ADMIN","POST","entities/MonthlySnapshot/bulk",[]),e=>e.status===403);
  assert.throws(()=>x.call("ADMIN","DELETE","entities/MonthlySnapshot",null),e=>e.status===403);
});

test("stale Pipeline revisions return 409 without mutation or audit",()=>{
  const x=fixture(), created=x.call("M1","POST","entities/Opportunity",newPipeline);
  const firstRevision=created.updated_date;
  const first=x.call("M1","PUT","entities/Opportunity/"+created.id,{
    expected_updated_at:firstRevision,stage_id:"S2",
  });
  assert.equal(first.stage_id,"S2");
  assert.notEqual(first.updated_date,firstRevision,"revision must advance even when clock is frozen");
  assert.throws(()=>x.call("M1","PUT","entities/Opportunity/"+created.id,{
    expected_updated_at:firstRevision,stage_id:"S3",
  }),e=>e.status===409);
  // Simulate a second user's committed edit since the original form was opened.
  const row=x.all["B2B_GEO_Pipeline_DB.xlsx|Pipelines"].rows[0];
  row.updated_at="2026-10-19T12:00:00.000Z";
  const audits=x.all["B2B_GEO_Pipeline_DB.xlsx|Pipeline_Events"].rows.length;
  const touches=x.touched.length;
  assert.throws(()=>x.call("M1","PUT","entities/Opportunity/"+created.id,{
    expected_updated_at:firstRevision,stage_id:"S3",
  }),e=>e.status===409);
  assert.equal(row.stage_id,"S2");
  assert.equal(x.all["B2B_GEO_Pipeline_DB.xlsx|Pipeline_Events"].rows.length,audits);
  assert.equal(x.touched.length,touches);
});

test("server-side import writes once and a retry is idempotent",()=>{
  const x=fixture();
  const payload={batch_id:"uat-import-batch-00000001",items:[
    {...newPipeline,business_id:"100001"},
    {...newPipeline,business_id:"100002"}
  ]};
  const first=x.call("ADMIN","POST","imports/opportunities",payload);
  assert.equal(first.imported,2);
  assert.equal(first.already_imported,false);
  assert.equal(x.all["B2B_GEO_Pipeline_DB.xlsx|Pipelines"].rows.length,2);
  assert.equal(x.all["B2B_GEO_Pipeline_DB.xlsx|Pipeline_Events"].rows.length,2);
  const second=x.call("ADMIN","POST","imports/opportunities",payload);
  assert.equal(second.imported,0);
  assert.equal(second.already_imported,true);
  assert.deepEqual(second.opportunity_ids,first.opportunity_ids);
  assert.equal(x.all["B2B_GEO_Pipeline_DB.xlsx|Pipelines"].rows.length,2);
  assert.throws(()=>x.call("ADMIN","POST","imports/opportunities",{
    ...payload,items:[{...newPipeline,business_id:"100003"},payload.items[1]]
  }),e=>e.status===409);
  assert.throws(()=>x.call("ADMIN","POST","imports/opportunities",{
    batch_id:"uat-import-batch-00000002",items:payload.items
  }),e=>e.status===409);
});
test("batch import rejects unauthorized roles and duplicates before writing",()=>{
  const x=fixture();
  const input={batch_id:"uat-import-batch-00000003",items:[
    {...newPipeline,business_id:"100004"},
    {...newPipeline,business_id:"100004"}
  ]};
  assert.throws(()=>x.call("AE1","POST","imports/opportunities",input),e=>e.status===403);
  assert.throws(()=>x.call("ADMIN","POST","imports/opportunities",input),e=>e.status===409);
  assert.equal(x.all["B2B_GEO_Pipeline_DB.xlsx|Pipelines"].rows.length,0);
  assert.throws(()=>x.call("ADMIN","POST","entities/Opportunity/bulk",input.items),e=>e.status===403);
});
