import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canDeletePipeline } from "../src/lib/pipelineDeletePermission.js";

const op = { id:"OPP001",owner_id:"AE1",current_handler_id:"SM1",region_id:"R1" };
const load = path => readFileSync(new URL("../src/" + path,import.meta.url),"utf8");

test("AE Owner and Current Handler can use Delete without Admin approval",()=>{
  assert.equal(canDeletePipeline({id:"AE1",app_role:"ae"},op),true);
  assert.equal(canDeletePipeline({id:"SM1",app_role:"ae"},op),true);
  assert.equal(canDeletePipeline({id:"AE2",app_role:"ae"},op),false);
});

test("SM can delete their Region only, and Demo As cannot delete",()=>{
  assert.equal(canDeletePipeline({id:"S1",app_role:"sm",region_ids:["R1"]},op),true);
  assert.equal(canDeletePipeline({id:"S2",app_role:"sm",region_ids:["R2"]},op),false);
  assert.equal(canDeletePipeline({id:"AE1",app_role:"ae",isDemo:true},op),false);
  assert.equal(canDeletePipeline({id:"ADMIN",app_role:"admin",isDemo:true},op),false);
  assert.equal(canDeletePipeline({id:"ADMIN",app_role:"admin"},op),true);
  assert.equal(canDeletePipeline(null,op),false);
  assert.equal(canDeletePipeline({app_role:"ae",id:"AE1"},null),false);
});

test("Delete is directly visible to AE/SM in Quick View header and Detail toolbar",()=>{
  const quick = load("components/PipelineQuickView.jsx");
  const detail = load("pages/OpportunityDetail.jsx");
  const dialog = load("components/DeletePipelineDialog.jsx");
  assert.ok(quick.includes("const canDelete = canDeletePipeline(profile, op)"));
  assert.ok(quick.includes('aria-label="ลบ Pipeline"'));
  assert.ok(quick.includes("onClick={openDelete}"));
  assert.ok(quick.includes("open={open && !deleteOpen}"),
    "do not stack Radix dialogs when opening deletion confirmation");
  assert.ok(detail.includes("const canSoftDelete = canDeletePipeline(profile, op)"));
  assert.ok(detail.includes('onClick={() => setDeleteOpen(true)}'));
  assert.ok(detail.includes("<Trash2") && detail.includes("ลบ Pipeline"));
  assert.ok(dialog.includes("await deletePipeline(op.id, reason.trim())"));
  assert.ok(dialog.includes("ไม่ต้องขออนุมัติ Admin"));
  assert.ok(dialog.includes("reason.trim().length < 3"));
  assert.ok(!dialog.includes("approveDelete") && !dialog.includes("requestApproval"));
});

test("Delete remains an audited soft-delete API and never the generic hard-delete endpoint",()=>{
  const context = load("lib/dataContext.jsx");
  const api = load("api/client.js");
  assert.ok(context.includes("db.pipelineTrash.delete(id, reason, revision)"));
  assert.ok(api.includes('request("POST", `/pipeline-trash/${encodeURIComponent(id)}/delete`'));
  assert.ok(!context.includes('db.entities.Opportunity.delete('));
});
