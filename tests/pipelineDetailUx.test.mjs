import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const file=(path)=>fs.readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("Full Detail follows Create sections and uses contextual Needs Support once",()=>{
  const s=file("src/pages/OpportunityDetail.jsx");
  for(const title of ["Customer Information","Product & Value","Pipeline Information","Ownership & Support","Activity History"])
    assert.ok(s.includes(title),title);
  assert.ok(s.indexOf("Customer Information")<s.indexOf("Product & Value"));
  assert.ok(s.indexOf("Product & Value")<s.indexOf("Pipeline Information"));
  assert.ok(s.indexOf("Pipeline Information")<s.indexOf("Ownership & Support"));
  assert.ok(s.includes('<SupportToggleAction op={op} canEdit={canEdit} />'));
  assert.equal((s.match(/<SupportToggleAction /g)||[]).length,1);
  assert.ok(s.includes('<HistoryTimeline opportunityId={op.id} revision={op.updated_date} />'));
  assert.ok(!s.includes('"Opportunity not found"'));
});
test("Quick View keeps a single support action, no collaborator-person inputs",()=>{
  const s=file("src/components/PipelineQuickView.jsx");
  assert.ok(s.includes("<SupportToggleAction "));
  assert.ok(!s.includes("onUsers="));
  assert.ok(!s.includes("workingUserIds"));
  assert.ok(s.includes('profile?.app_role === "management"'));
});
test("Working With dropdown keeps Other last and uses only team IDs",()=>{
  const s=file("src/components/WorkingWithMultiSelect.jsx");
  assert.ok(s.includes("otherA !== otherB"));
  assert.ok(s.includes("PopoverContent"));
  assert.ok(s.includes("onTeams"));
  assert.ok(!s.includes("onUsers"));
  assert.ok(!s.includes("activePeople"));
});
test("Edit and History do not create duplicated support input or person editing",()=>{
  const edit=file("src/components/OpportunityForm.jsx");
  const history=file("src/components/HistoryTimeline.jsx");
  assert.ok(!edit.includes("<Switch checked={form.support_needed}"));
  assert.ok(!edit.includes("onUsers="));
  assert.ok(history.includes('Pipeline created'));
  assert.ok(history.includes('revision'));
  assert.ok(file("src/components/AppLayout.jsx").includes('return "Pipeline";'));
});

test("Quick Update keeps the starting revision even if Context refreshes during editing",()=>{
 const quick=file("src/components/PipelineQuickView.jsx");
 const context=file("src/lib/dataContext.jsx");
 assert.ok(quick.includes("const [baseline, setBaseline] = useState(() => snapshot(op))"));
 assert.ok(quick.includes("if (baseline.id === next.id && changed) return"));
 assert.ok(quick.includes("expectedUpdatedAt: baseline.revision"));
 assert.ok(quick.includes("op.working_with_team_ids, baseline, changed"));
 assert.ok(context.includes("return updateWithHistory(id, changes, null, { expectedUpdatedAt });"));
 assert.ok(context.includes('error.status === 409'));
});
