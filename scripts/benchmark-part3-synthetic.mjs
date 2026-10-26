// Reproducible, fully synthetic Node benchmark for shared Core read workload.
// This does NOT measure Google Apps Script runtime, LockService, network or Sheets quotas.
// Run: node scripts/benchmark-part3-synthetic.mjs --rows 200 --requests 80 --clients 8
import { performance } from "node:perf_hooks";
import { createCore } from "../server/core.js";

function option(name, fallback) {
  const at = process.argv.indexOf("--" + name);
  if (at < 0) return fallback;
  const value = Number(process.argv[at + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 5000) throw Error("Invalid --" + name + " (1-5000)");
  return value;
}
const rowCount = option("rows",200);
const requests = option("requests",80);
const clients = option("clients",8);
const ORG="synthetic-org.xlsx", DB="synthetic-db.xlsx";
const access={
  scope:{AE:"own",SM:"region",Admin:"all"},
  demo_as_allowed_for:["Admin"],
  files:{
    [ORG]:{sheets:{
      Users:{entity:"users",primary_key:"user_id",permissions:{read:["AE","SM","Admin"]}},
      User_Region:{entity:"user_regions",primary_key:"user_region_id",permissions:{read:["AE","SM","Admin"]}},
    }},
    [DB]:{sheets:{
      Pipelines:{entity:"opportunities",primary_key:"opportunity_id",scoped:true,
        permissions:{read:["AE","SM","Admin"]}},
      Pipeline_Events:{entity:"opportunity_events",primary_key:"event_id",scoped:true,append_only:true,
        permissions:{read:["AE","SM","Admin"]}},
    }}
  }
};
const tables={
  [ORG+"|Users"]:[
    {user_id:"AE1",display_name:"Synthetic AE",role:"AE",status:"Active"},
    {user_id:"AE2",display_name:"Synthetic AE2",role:"AE",status:"Active"},
    {user_id:"SM1",display_name:"Synthetic SM",role:"SM",status:"Active"},
    {user_id:"ADMIN1",display_name:"Synthetic Admin",role:"Admin",status:"Active"},
  ],
  [ORG+"|User_Region"]:[
    {user_id:"AE1",region_id:"R1",active:"Yes"},
    {user_id:"AE2",region_id:"R2",active:"Yes"},
    {user_id:"SM1",region_id:"R1",active:"Yes"},
  ],
  [DB+"|Pipelines"]:Array.from({length:rowCount},(_,i)=>({
    opportunity_id:"SYN-"+String(i+1).padStart(6,"0"),
    owner_user_id:i%2?"AE2":"AE1",
    current_handler_user_id:i%2?"AE2":"AE1",
    region_id:i%2?"R2":"R1",
    customer_name:"Synthetic business "+i,
    stage_id:"STAGE1",status:"Open",expected_close_month:"2026-11",
    pipeline_value:100+i,
  })),
  [DB+"|Pipeline_Events"]:[],
};
const store={
  table(file,sheet) {return {headers:[],rows:tables[file+"|"+sheet]||[]};},
  touch(){throw Error("Benchmark is read-only");},
};
const core=createCore({contract:{access,columns:{}},store,
  now:()=>"2026-10-26T10:00:00Z",uuid:()=>"SYNTHETIC"});
let queue=Promise.resolve();
function serialized(operation) {
  // Models a single critical section, but NOT Apps Script execution scheduling.
  const result=queue.then(operation);
  queue=result.catch(()=>{});
  return result;
}
function percentile(xs,fraction) {
  if(!xs.length)return 0;
  const sorted=[...xs].sort((a,b)=>a-b);
  return Number(sorted[Math.ceil(sorted.length*fraction)-1].toFixed(3));
}
async function scenario(name,actor,batched) {
  const latencies=[],start=performance.now();
  const workerCount=Math.min(requests,clients);
  await Promise.all(Array.from({length:workerCount},(_,clientId)=>(async()=>{
    for(let index=clientId;index<requests;index+=workerCount){
      const enqueueTime=performance.now();
      await serialized(()=>{
        const result=batched
          ?core.handle({userId:actor,method:"POST",path:"batch",body:{requests:[
            {path:"entities/Opportunity",method:"GET"},
            {path:"entities/TeamMember",method:"GET"}
          ]}})
          :core.handle({userId:actor,method:"GET",path:"entities/Opportunity"});
        if(!Array.isArray(result))throw Error("Unexpected benchmark API response");
      });
      latencies.push(performance.now()-enqueueTime);
    }
  })()));
  const elapsed=performance.now()-start;
  return {scenario:name,rows:rowCount,requests,clients:workerCount,
    total_ms:Number(elapsed.toFixed(3)),p50_ms:percentile(latencies,.5),
    p95_ms:percentile(latencies,.95),
    requests_per_second:Number((requests*1000/Math.max(elapsed,.001)).toFixed(2))};
}
for(const [name,actor,batched] of [
  ["AE scoped list","AE1",false],
  ["SM Region list","SM1",false],
  ["Admin list","ADMIN1",false],
  ["SM two-read batch","SM1",true],
]){
  console.log(JSON.stringify(await scenario(name,actor,batched)));
}
