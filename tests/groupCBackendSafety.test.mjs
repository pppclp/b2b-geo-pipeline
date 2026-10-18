import test from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../server/core.js";
import { loadContract } from "../server/contract.js";

const contract = loadContract(new URL("../b2b_geo_pipeline.yaml", import.meta.url));
const ORG = "B2B_GEO_User_Org_Master.xlsx";
const DB = "B2B_GEO_Pipeline_DB.xlsx";

function fixture() {
  const seed = {
    [ORG + "/Users"]: [
      {user_id:"AE1",employee_id:"900001",role:"AE",status:"Active",display_name:"Employee"},
      {user_id:"AE2",employee_id:"900002",role:"AE",status:"Active",display_name:"Employee 2"},
      {user_id:"ADMIN",employee_id:"900003",role:"Admin",status:"Active",display_name:"Administrator"}
    ],
    [ORG + "/User_Region"]: [
      {user_region_id:"UR1",user_id:"AE1",region_id:"R1",active:"Yes"},
    ],
    [ORG + "/Regions"]: [{region_id:"R1",region_name:"East",active:"Yes"}],
    [DB + "/Admin_Audit"]: [],
  };
  const tables={};
  const touched=[];
  const store={
    table(file,sheet) {
      const key=file+"/"+sheet;
      if(!tables[key]) tables[key]={headers:Object.keys(seed[key]?.[0]||{}),rows:seed[key]||[]};
      return tables[key];
    },
    touch(file,sheet) {touched.push(file+"/"+sheet);}
  };
  let n=0;
  const core=createCore({contract,store,now:()=>"2026-10-18T10:00:00.000Z",uuid:()=>String(++n)});
  const call=(userId,method,path,body,query)=>core.handle({userId,method,path,body,query});
  return {call,store,touched,users:()=>store.table(ORG,"Users").rows,regions:()=>store.table(ORG,"Regions").rows,audit:()=>store.table(DB,"Admin_Audit").rows};
}
const error=(status)=>(err)=>err.status===status;
const usersPath="sheets/"+ORG+"/Users";

test("C1: bulk DELETE is rejected, including unfiltered Admin requests, without mutations",()=>{
 const x=fixture();const before=JSON.stringify(x.regions());
 assert.throws(()=>x.call("ADMIN","DELETE","entities/Region",undefined,{}),error(405));
 assert.throws(()=>x.call("ADMIN","DELETE","entities/Region",undefined,{q:{id:"R1"}}),error(405));
 assert.equal(JSON.stringify(x.regions()),before);
 assert.equal(x.audit().length,0);
 assert.deepEqual(x.touched,[]);
 // The audited single-ID operation remains usable for non-referenced masters.
 const row=x.call("ADMIN","POST","entities/Region",{name:"Unused",active:true});
 const removed=x.call("ADMIN","DELETE","entities/Region/"+encodeURIComponent(row.id));
 assert.deepEqual(removed,{ok:true});
 assert.ok(x.audit().some(e=>e.event_type==="DELETED"));
});

test("C2: reject unbounded and nested batch requests but allow bounded reads",()=>{
 const x=fixture();
 const get=()=>({path:"entities/Region",method:"GET"});
 assert.throws(()=>x.call("ADMIN","POST","batch",{requests:Array(31).fill(null).map(get)}),error(400));
 assert.throws(()=>x.call("ADMIN","POST","batch",{requests:[{path:"batch",method:"GET"}]}),error(400));
 assert.throws(()=>x.call("ADMIN","POST","batch",{requests:[{path:"/batch",method:"GET"}]}),error(400));
 assert.throws(()=>x.call("ADMIN","POST","batch",{requests:[{path:"entities/Region",method:"DELETE"}]}),error(400));
 assert.throws(()=>x.call("ADMIN","POST","batch",{requests:"not-an-array"}),error(400));
 assert.throws(()=>x.call("ADMIN","GET","batch",{requests:[get()]}),error(405));
 const result=x.call("AE1","POST","batch",{requests:[get(),get()]});
 assert.deepEqual(result.map(r=>r.status),[200,200]);
 assert.equal(result[0].body[0].id,"R1");
});

test("C5: Team Member create/update validates role, boolean active and unique employee ID",()=>{
 const x=fixture();
 assert.throws(()=>x.call("ADMIN","POST","entities/TeamMember",{name:"Bad role",app_role:"root",active:true}),error(400));
 assert.throws(()=>x.call("ADMIN","POST","entities/TeamMember",{name:"Bad status",app_role:"sm",active:"Inactive"}),error(400));
 assert.throws(()=>x.call("ADMIN","POST","entities/TeamMember",{name:"Duplicate",employee_id:"900001",app_role:"ae",active:true}),error(409));
 assert.throws(()=>x.call("ADMIN","PUT","entities/TeamMember/AE1",{app_role:"superadmin"}),error(400));
 assert.throws(()=>x.call("ADMIN","PUT","entities/TeamMember/AE1",{active:"no"}),error(400));
 assert.equal(x.users().find(x=>x.user_id==="AE1").role,"AE");
 const created=x.call("ADMIN","POST","entities/TeamMember",{name:"Real account",employee_id:"0099900",app_role:"sm",active:true});
 const persisted=x.users().find(u=>u.user_id===created.id);
 assert.equal(persisted.employee_id,"0099900");
 assert.equal(persisted.role,"SM");
 assert.equal(persisted.status,"Active");
 assert.ok(x.audit().some(e=>e.source_sheet==="Users"));
});

test("C5: Source Sheet enforces role/status and protects IDs and Master from invalid writes",()=>{
 const x=fixture();
 for(const patch of [{role:"Superuser"},{role:""},{status:"Pending"},{status:""}]){
   assert.throws(()=>x.call("ADMIN","PUT",usersPath+"/AE1",patch),error(400));
 }
 assert.throws(()=>x.call("ADMIN","PUT",usersPath+"/AE1",{employee_id:"900002"}),error(409));
 assert.throws(()=>x.call("ADMIN","POST",usersPath,{user_id:"X1",employee_id:"0001",role:"Owner",status:"Active"}),error(400));
 assert.equal(x.audit().length,0);
 assert.equal(x.users().find(u=>u.user_id==="AE1").employee_id,"900001");
 const created=x.call("ADMIN","POST",usersPath,{user_id:"X1",employee_id:"0001",display_name:"Valid",role:"Management",status:"Inactive"});
 assert.equal(created.employee_id,"0001");
 assert.equal(typeof created.employee_id,"string");
 x.call("ADMIN","PUT",usersPath+"/X1",{status:"Active",employee_id:"0812345678"});
 assert.equal(x.users().find(u=>u.user_id==="X1").employee_id,"0812345678");
 assert.equal(x.users().find(u=>u.user_id==="X1").status,"Active");
});
