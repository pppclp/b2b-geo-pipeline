import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { managementTeamId, isWithMePipeline, withMePipelines } from "../src/lib/dashboardQueue.js";

const source = (path) => fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Management With Me contains only active Pipelines explicitly assigned as Current Handler", () => {
  const data = [
    { id:"approval",status:"open",current_handler_id:"MGMT-1",support_needed:false,region_id:"R1" },
    { id:"supportOnly",status:"open",current_handler_id:"SM-1",support_needed:true,region_id:"R1" },
    { id:"otherManager",status:"open",current_handler_id:"MGMT-2",support_needed:true,region_id:"R1" },
    { id:"closed",status:"won",current_handler_id:"MGMT-1",region_id:"R1" },
    { id:"otherRegion",status:"open",current_handler_id:"MGMT-1",region_id:"R2" },
  ];
  assert.deepEqual(withMePipelines(data, "MGMT-1").map(x=>x.id), ["approval","otherRegion"]);
  // Backend-scoped cohort is applied first. With Me cannot broaden access.
  assert.deepEqual(withMePipelines(data.filter(x=>x.region_id==="R1"),"MGMT-1").map(x=>x.id),["approval"]);
  assert.deepEqual(withMePipelines(data,""),[]);
});

test("Management Action Queue preserves With Me and Region after Support retirement", () => {
  const s=source("src/pages/Dashboard.jsx");
  assert.ok(s.includes('["with", "With Me"], ["overdue", "Overdue"]'));
  assert.ok(!s.includes('["support", "Needs Support"]'));
  assert.ok(s.includes('const assigned = withMePipelines(cohort, profile?.id, {'));
  assert.ok(s.includes('["with", "With Me"]'), "The With Me quick-view tab remains in English");
  assert.ok(s.includes('title="Pipeline ที่ส่งให้ฉัน"'), "KPI uses the canonical Pipeline noun");
  assert.ok(s.includes('regionColumn={isManagement}'));
  assert.ok(s.includes('{regionColumn && <th className="py-1.5 pr-2 text-left font-medium">Region</th>}'));
  assert.ok(s.includes('className="h-[52px] border-b border-border last:border-0"'));
  assert.ok(s.includes('flex min-w-0 flex-col justify-center gap-0.5'));
  assert.ok(s.includes('selectedTab === "with" ? "handler_since"'));
  assert.ok(s.includes('const withMeQuery = isManagement ? { with_me: "1" } : { handler: profile?.id };'));
  assert.ok(s.includes('...(selectedTab === "with" ? withMeQuery : {}),'));
  assert.ok(s.includes('onClick={() => toPipeline({ status: "open", ...withMeQuery })}'));
});

test("Dashboard KPI copy is concise, English controls are retained, and queue empty states describe the selected view", () => {
  const dashboard = source("src/pages/Dashboard.jsx");
  const layout = source("src/components/AppLayout.jsx");
  assert.ok(dashboard.includes('title="มูลค่า Pipeline รวม"'));
  assert.ok(dashboard.includes('note="Net RC · Open + Won"'));
  assert.ok(dashboard.includes('title="Pipeline ที่ส่งให้ฉัน"'));
  assert.ok(dashboard.includes('"ของฉัน / ทีม Management"'));
  assert.ok(dashboard.includes('title="Pipeline เกินกำหนด"'));
  assert.ok(dashboard.includes('note="ต้องติดตาม"'));
  assert.ok(dashboard.includes('function Metric({ title, value, note, onClick })'));
  assert.ok(dashboard.includes('fontSize: "13px"'));
  assert.ok(dashboard.includes('lineHeight: "18px"'));
  assert.ok(dashboard.includes('fontWeight: 600'));
  assert.ok(dashboard.includes('className="geo-metric-label truncate" title={title}'));
  assert.ok(dashboard.includes('title="มูลค่า Pipeline ที่เปิดอยู่"'));
  assert.ok(dashboard.includes('"Net RC · ในภาค"'));
  assert.ok(dashboard.includes('"Net RC · ของฉัน"'));
  assert.ok(!dashboard.includes('subtitle="Total Pipeline Value"'));
  assert.ok(!dashboard.includes('subtitle="Open Pipeline Value"'));
  assert.ok(!dashboard.includes('subtitle="With Me"'));
  assert.ok(!dashboard.includes('subtitle="Overdue"'));
  assert.ok(dashboard.includes('>สถานะ Pipeline</div>'));
  assert.ok(dashboard.includes('"Expected Close · All Months"'));
  assert.ok(dashboard.includes('"ไม่มี Pipeline ที่ส่งให้ฉัน"'));
  assert.ok(dashboard.includes('emptyMessage={queueEmptyMessage}'));
  assert.ok(dashboard.includes('placeholder="All Months"'));
  assert.ok(dashboard.includes('>View All</Button>'));
  assert.ok(layout.includes('Updated ${minutesSinceLoad} min ago'));
  assert.ok(layout.includes('Sign out'));
  assert.ok(dashboard.includes('"Management overview"'));
});

test("Management Working With makes open Pipelines visible to every authorized manager without changing Handler", () => {
  const teams = [
    {id:"WW001",name:"Pre-sales",active:true},
    {id:"WW007",name:"Management",active:true},
  ];
  assert.equal(managementTeamId(teams),"WW007");
  const data = [
    {id:"assigned",status:"open",region_id:"R1",current_handler_id:"MGMT1",working_with_team_ids:""},
    {id:"management",status:"open",region_id:"R1",current_handler_id:"SM1",working_with_team_ids:"WW007"},
    {id:"multiTeam",status:"open",region_id:"R1",current_handler_id:"AE1",working_with_team_ids:" WW001, WW007 "},
    {id:"preSales",status:"open",region_id:"R1",current_handler_id:"SM1",working_with_team_ids:"WW001"},
    {id:"otherManager",status:"open",region_id:"R1",current_handler_id:"MGMT2",working_with_team_ids:""},
    {id:"closed",status:"won",region_id:"R1",current_handler_id:"MGMT1",working_with_team_ids:"WW007"},
    {id:"otherRegion",status:"open",region_id:"R2",current_handler_id:"SM2",working_with_team_ids:"WW007"},
  ];
  const management = {role:"management",teams};
  assert.deepEqual(withMePipelines(data,"MGMT1",management).map(o=>o.id),
    ["assigned","management","multiTeam","otherRegion"]);
  assert.deepEqual(withMePipelines(data,"MGMT2",management).map(o=>o.id),
    ["management","multiTeam","otherManager","otherRegion"]);
  assert.deepEqual(withMePipelines(data.filter(o=>o.region_id==="R1"),"MGMT2",management).map(o=>o.id),
    ["management","multiTeam","otherManager"]);
  assert.deepEqual(withMePipelines(data,"SM1",{role:"sm",teams}).map(o=>o.id),["management","preSales"]);
  assert.deepEqual(withMePipelines(data,"AE1",{role:"ae",teams}).map(o=>o.id),["multiTeam"]);
  assert.equal(data[1].current_handler_id,"SM1","Working With never changes Current Handler");
});

test("Management matching fails closed without a unique active configured team", () => {
  const row={status:"open",current_handler_id:"AE1",working_with_team_ids:"WW007",working_with:"Management"};
  for(const teams of [
    [],
    [{id:"WW007",name:"Management",active:false}],
    [{id:"WW007",name:"Management",active:true},{id:"WW008",name:"management",active:true}],
  ]) {
    assert.equal(isWithMePipeline(row,"MGMT1",{role:"management",teams}),false);
  }
  assert.equal(isWithMePipeline(row,"AE1",{role:"ae",teams:[]}),true,"Direct Handler is unaffected");
  assert.equal(isWithMePipeline(row,"MGMT1",{role:"sm",teams:[{id:"WW007",name:"Management",active:true}]}),false);
  assert.equal(isWithMePipeline(row,"",{role:"management",teams:[{id:"WW007",name:"Management",active:true}]}),false);
});

test("Legacy single-team Management rows remain visible; selected non-Management teams are authoritative", () => {
  const context={role:"management",teams:[{id:"WW007",name:"Management",active:true}]};
  assert.equal(isWithMePipeline({status:"open",current_handler_id:"SM1",working_with:"Management"},"MGMT1",context),true);
  assert.equal(isWithMePipeline({status:"open",current_handler_id:"SM1",working_with_id:"WW007"},"MGMT1",context),true);
  assert.equal(isWithMePipeline({status:"open",current_handler_id:"SM1",working_with:"Management",working_with_team_ids:"WW001"},"MGMT1",context),false);
});


test("Dashboard queue uses centered compact rows, fixed widths and colored Stage tags", () => {
  const dashboard = source("src/pages/Dashboard.jsx");
  assert.ok(dashboard.includes('h-[52px] border-b border-border last:border-0'));
  assert.ok(dashboard.includes('flex min-w-0 flex-col justify-center gap-0.5'));
  assert.ok(!dashboard.includes('min-h-[16px] min-w-0 flex-nowrap'), "No empty second line that shifts customer alignment");
  assert.ok(dashboard.includes('regionColumn ? "min-w-[560px]" : "min-w-[410px]"'));
  assert.ok(dashboard.includes('<col className="w-[106px]" />'));
  assert.ok(dashboard.includes('<col className="w-[116px]" />'));
  assert.ok(dashboard.includes('{regionColumn && <col className="w-[118px]" />}'));
  assert.ok(dashboard.includes('pipelineStageDisplay(o, activeStages, maps.stage)'));
  assert.ok(dashboard.includes('DASHBOARD_STAGE_BADGE_TONES[stageDisplay.tone]'));
  assert.ok(dashboard.includes('overflow-x-auto'));
  assert.ok(dashboard.includes('tabular-nums whitespace-nowrap'));
});

test("Dashboard month-first defaults can be cleared and never invisibly filter Admin", () => {
  const dashboard = source("src/pages/Dashboard.jsx");
  assert.ok(dashboard.includes('useState(() => currentMonthKey())'));
  assert.ok(dashboard.includes('const [queueTab, setQueueTab] = useState("due")'));
  assert.ok(dashboard.includes('const effectiveCloseMonth = isAdmin ? "" : closeMonth'));
  assert.ok(dashboard.includes('closeMonth: effectiveCloseMonth, region'));
  assert.ok(dashboard.includes('if (!month) setQueueTab("with")'));
  assert.ok(dashboard.includes('setCloseMonth(""); setRegionFilter(""); setQueueTab("with")'));
  assert.ok(dashboard.includes('selectedTab === "due" && !closeMonth'));
});

test("Create Pipeline permits a blank Business ID, but validates an entered ID", () => {
  const create = source("src/components/CreatePipelineModal.jsx");
  const validation = source("src/lib/pipelineValidation.js");
  assert.ok(create.includes('if (businessIdError(form.business_id))'));
  assert.ok(create.includes('<Field label="รหัสธุรกิจ (Business ID)" error='));
  assert.ok(!create.includes('<Field label="รหัสธุรกิจ (Business ID)" required'));
  assert.ok(create.includes('maxLength={40} value={form.business_id}'));
  assert.ok(validation.includes('if (!id) return ""'));
});
