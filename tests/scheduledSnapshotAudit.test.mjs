import test from "node:test";
import assert from "node:assert/strict";
import {createOutputs} from "../server/outputs.js";
test("scheduled snapshots are audited as system, never impersonating a human Admin",()=>{
 const files={"B2B_GEO_Pipeline_DB.xlsx|Admin_Audit":{headers:[
   "audit_id","event_type","source_file","source_sheet","source_record_id","field_name",
   "previous_value","new_value","actor_user_id","actor_name","actor_role","event_at"],rows:[]}};
 const touched=[];
 const store={table:(f,s)=>files[f+"|"+s],touch:(f,s)=>touched.push(f+"|"+s)};
 const contract={access:{files:{"B2B_GEO_Pipeline_DB.xlsx":{sheets:{
   Admin_Audit:{entity:"admin_audit",primary_key:"audit_id"}
 }}}}};
 const writer=createOutputs({contract,store,now:()=>"2026-11-01T00:00:00Z",uuid:()=>"abcd"});
 writer.logScheduledSnapshot("2026-10",112);
 assert.equal(files["B2B_GEO_Pipeline_DB.xlsx|Admin_Audit"].rows[0].actor_user_id,"SYSTEM_MONTH_END");
 assert.equal(files["B2B_GEO_Pipeline_DB.xlsx|Admin_Audit"].rows[0].actor_role,"system");
 assert.equal(files["B2B_GEO_Pipeline_DB.xlsx|Admin_Audit"].rows[0].source_record_id,"2026-10");
 assert.deepEqual(touched,["B2B_GEO_Pipeline_DB.xlsx|Admin_Audit"]);
});
