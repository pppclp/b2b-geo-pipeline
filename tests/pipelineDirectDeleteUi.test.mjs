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

test("Delete is accessible only inside Edit or read-only management, never in quick view or detail toolbar",()=>{
  const quick = load("components/PipelineQuickView.jsx");
  const detail = load("pages/OpportunityDetail.jsx");
  const edit = load("components/OpportunityForm.jsx");
  const dialog = load("components/DeletePipelineDialog.jsx");
  assert.ok(!quick.includes("DeletePipelineDialog") && !quick.includes("Trash2"));
  assert.ok(!detail.includes("DeletePipelineDialog") && !detail.includes("Trash2"));
  assert.ok(detail.includes("const canSoftDelete = canDeletePipeline(profile, op)"));
  assert.ok(detail.includes("(canEdit || canSoftDelete) && <Button"));
  assert.ok(detail.includes("deleteOnly={!canEdit}"),"closed Pipelines can still be deleted without editing them");
  assert.ok(edit.includes("const canDelete = canDeletePipeline(profile, opportunity)"));
  assert.ok(edit.includes("open={open && !deleteOpen}"),"do not stack Radix dialogs");
  assert.ok(edit.includes("!deleteOnly && <Button"),"read-only management cannot save changes");
  assert.ok(edit.indexOf('onClick={() => setDeleteOpen(true)}') > edit.indexOf("<DialogFooter"));
  assert.ok(edit.includes("<DeletePipelineDialog op={opportunity}"));
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

test("Pipeline list has no per-row delete shortcut and retains Recycle Bin",()=>{
  const list=load("pages/Pipeline.jsx");
  assert.ok(!list.includes("canDeletePipeline(profile, o)"));
  assert.ok(!list.includes("deleteTarget"));
  assert.ok(!list.includes("<DeletePipelineDialog"));
  assert.ok(list.includes('navigate("/pipeline-trash")'),"retain Recycle Bin");
  assert.ok(list.includes("Current Handler</th>"),"retain table layout");
});
