import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { History, RotateCcw, ArrowLeftRight, ShieldCheck } from "lucide-react";
import { useData } from "@/lib/dataContext";
import { overdueReasons } from "@/lib/overdueSummary";
import { ageInDays } from "@/lib/dashboardMetrics";
import OverdueTags from "@/components/OverdueTags";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";

// Local-only demo personas: NOT credentials or records in Users / User_Region.
const AE = { id: "DEMO_AE_01", name: "คุณฟ้า · AE Demo", app_role: "ae" };
const SM = { id: "DEMO_SM_01", name: "คุณสม · SM Demo", app_role: "sm" };
const USERS = [AE, SM];
const FALLBACK_STAGES = {
  STG001: { id: "STG001", name: "Stage 1", sla_days: 7 },
  STG002: { id: "STG002", name: "Stage 2", sla_days: 7 },
};
const FALLBACK_TEAMS = [
  { id: "WW002", name: "Pricer", sla_days: 5 },
  { id: "WW005", name: "Management", sla_days: 5 },
];
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
const elapsed = (value) => value ? String(ageInDays(value)) + " วัน" : "—";
const person = (id) => USERS.find(u => u.id === id)?.name || "—";

function mockPipelines() {
  const common = { status: "open", owner_id: AE.id, region_id: "REG_DEMO" };
  return [
    { ...common, id: "DEMO-001", customer_name: "บริษัท แมวเหมียว 5G จำกัด",
      stage_id: "STG001", stage_entered_at: ago(9),
      current_handler_id: AE.id, handler_since: ago(7),
      working_with_id: "", working_with_team_ids: "", working_with_since: "" },
    { ...common, id: "DEMO-002", customer_name: "บริษัท ชานมขอส่วนลด จำกัด",
      stage_id: "STG002", stage_entered_at: ago(4),
      current_handler_id: SM.id, handler_since: ago(8),
      working_with_id: "WW002", working_with_team_ids: "WW002", working_with_since: ago(6) },
    { ...common, id: "DEMO-003", customer_name: "บริษัท เต่าขึ้นคลาวด์ จำกัด",
      stage_id: "STG002", stage_entered_at: ago(10),
      current_handler_id: SM.id, handler_since: ago(9),
      working_with_id: "WW005", working_with_team_ids: "WW005", working_with_since: ago(6) },
  ];
}

function mockHistory() {
  const entries = [
    ["DEMO-001",18,AE.id,"สร้าง Pipeline · Stage 1"],
    ["DEMO-001",9,AE.id,"ติดตามลูกค้า · Stage 1"],
    ["DEMO-001",7,AE.id,"AE รับผิดชอบงานต่อเนื่อง"],
    ["DEMO-002",15,AE.id,"สร้าง Pipeline · Stage 1"],
    ["DEMO-002",8,AE.id,"ส่ง Current Handler จาก AE → SM"],
    ["DEMO-002",6,SM.id,"เพิ่ม Working With: Pricer"],
    ["DEMO-002",4,SM.id,"เปลี่ยน Stage 1 → Stage 2"],
    ["DEMO-003",17,AE.id,"สร้าง Pipeline · Stage 1"],
    ["DEMO-003",10,AE.id,"เปลี่ยน Stage 1 → Stage 2"],
    ["DEMO-003",9,AE.id,"ส่ง Current Handler จาก AE → SM"],
    ["DEMO-003",6,SM.id,"เพิ่ม Working With: Management"],
  ];
  return entries.map(([opportunity_id,days,actor_id,message],i) =>
    ({ id: "DEMO-EVT-" + i, opportunity_id, actor_id, message, event_at: ago(days) }));
}

export default function DemoPreview() {
  const { realProfile, profile, master, config } = useData();
  const navigate = useNavigate();
  const [viewerId, setViewerId] = useState(AE.id);
  const [records, setRecords] = useState(mockPipelines);
  const [events, setEvents] = useState(mockHistory);
  const [selectedId, setSelectedId] = useState("DEMO-001");
  const [withMe, setWithMe] = useState(false);
  const stages = useMemo(() => ({
    ...FALLBACK_STAGES,
    ...Object.fromEntries((master?.Stage || []).filter(s => ["STG001", "STG002"].includes(s.id)).map(s => [s.id, s])),
  }), [master?.Stage]);
  const teams = useMemo(() => {
    const found = (master?.WorkingWithOption || []).filter(t => ["WW002", "WW005"].includes(t.id));
    return found.length === 2 ? found : FALLBACK_TEAMS;
  }, [master?.WorkingWithOption]);
  const alertContext = {
    members: { [AE.id]: AE, [SM.id]: SM },
    teams,
    config: {
      handler_ae_sla_days: config?.handler_ae_sla_days ?? 5,
      handler_sm_sla_days: config?.handler_sm_sla_days ?? 5,
      internal_task_sla_days: config?.internal_task_sla_days ?? 5,
    },
  };
  const actor = USERS.find(u => u.id === viewerId) || AE;
  const selected = records.find(r => r.id === selectedId) || records[0];
  const visible = records.filter(r => !withMe || r.current_handler_id === actor.id);
  const history = events.filter(e => e.opportunity_id === selected.id)
    .sort((a,b) => new Date(b.event_at) - new Date(a.event_at));
  const canAct = selected.current_handler_id === actor.id;

  const appendEvent = (op, message) => setEvents(old => old.concat({
    id: "DEMO-LOCAL-" + Date.now() + "-" + old.length,
    opportunity_id: op.id, actor_id: actor.id, message, event_at: new Date().toISOString(),
  }));
  const changeStage = () => {
    if (!canAct) return;
    const to = selected.stage_id === "STG001" ? "STG002" : "STG001";
    setRecords(old => old.map(o => o.id === selected.id ? {
      ...o, stage_id: to, stage_entered_at: new Date().toISOString(),
    } : o));
    appendEvent(selected, "เปลี่ยน " + stages[selected.stage_id].name + " → " + stages[to].name);
  };
  const handoff = () => {
    if (!canAct) return;
    const to = actor.id === AE.id ? SM : AE;
    setRecords(old => old.map(o => o.id === selected.id ? {
      ...o, current_handler_id: to.id, handler_since: new Date().toISOString(),
    } : o));
    appendEvent(selected, "ส่ง Current Handler จาก " + actor.app_role.toUpperCase() + " → " + to.app_role.toUpperCase());
  };
  const toggleWorkingWith = () => {
    if (!canAct || selected.id === "DEMO-001") return;
    const team = selected.id === "DEMO-002" ? teams.find(t => t.id === "WW002") : teams.find(t => t.id === "WW005");
    if (!team) return;
    const on = selected.working_with_id !== team.id;
    setRecords(old => old.map(o => o.id === selected.id ? {
      ...o, working_with_id: on ? team.id : "",
      working_with_team_ids: on ? team.id : "",
      working_with_since: on ? new Date().toISOString() : "",
    } : o));
    appendEvent(selected, (on ? "เพิ่ม" : "ยกเลิก") + " Working With: " + team.name);
  };
  const reset = () => {
    setRecords(mockPipelines()); setEvents(mockHistory());
    setSelectedId("DEMO-001"); setViewerId(AE.id); setWithMe(false);
  };

  if (realProfile?.app_role !== "admin" || profile?.app_role !== "admin") {
    return <div className="p-6 space-y-3">
      <h1 className="text-lg font-semibold">Demo Preview — Admin only</h1>
      <p className="text-sm text-muted-foreground">ต้องเข้าสู่ระบบด้วยบัญชี Admin จริงเพื่อดู Demo จำลอง</p>
      <Button variant="outline" onClick={() => navigate("/")}>กลับ Dashboard</Button>
    </div>;
  }

  return <div className="px-4 py-5 md:px-7 md:py-6 space-y-5">
    <PageHeader title="Demo Preview" description="AE + SM จำลอง · 3 Pipelines · History · SLA"
      actions={<Button variant="outline" onClick={reset}><RotateCcw className="h-4 w-4 mr-2"/>Reset Demo</Button>} />
    <div role="status" className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-[13px] text-amber-900">
      <div className="font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4"/> DEMO ONLY · ไม่บันทึกข้อมูลจริง</div>
      <div className="mt-1">User จำลองไม่สามารถ Login ได้ · การเปลี่ยนแปลง/History อยู่ในหน่วยความจำของหน้านี้เท่านั้น · รีเฟรชเพื่อ Reset</div>
    </div>
    <div className="rounded-xl border border-border p-4 space-y-3">
      <h2 className="text-sm font-semibold">เลือก User จำลอง</h2>
      <div className="flex flex-wrap gap-2">{USERS.map(u =>
        <Button key={u.id} variant={actor.id === u.id ? "default" : "outline"}
          aria-pressed={actor.id === u.id} onClick={() => setViewerId(u.id)}>{u.name}</Button>
      )}</div>
      <p className="text-xs text-muted-foreground">กำลังจำลอง: {actor.name} · DEMO Region · สลับ AE/SM เพื่อดูงาน With Me และทดสอบส่งต่องาน</p>
    </div>
    <div className="space-y-3">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h2 className="text-sm font-semibold">Mock Pipelines · 3 รายการ</h2>
        <Button variant="outline" size="sm" aria-pressed={withMe} onClick={() => setWithMe(s => !s)}>
          {withMe ? "แสดงทั้งหมด" : "With Me — งานที่ส่งให้ฉัน"}
        </Button>
      </div>
      {visible.length === 0 && <p className="text-sm text-muted-foreground">ไม่มีงานอยู่กับ User จำลองนี้</p>}
      <div className="grid gap-2">{visible.map(op => {
        const result = overdueReasons(op, stages, 7, [], alertContext);
        return <button key={op.id} type="button" onClick={() => setSelectedId(op.id)}
          className={"w-full text-left rounded-xl border p-4 " +
            (op.id === selected.id ? "border-red-300 bg-red-50/50" : "border-border hover:bg-secondary/50")}>
          <div className="flex justify-between flex-wrap gap-2 text-[13px]">
            <span className="font-semibold">{op.customer_name}</span>
            <span className="text-xs text-muted-foreground">{result.any ? "มี Alert" : "ปกติ"}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {stages[op.stage_id]?.name} · Handler: {person(op.current_handler_id)} ·
            Working With: {teams.find(t => t.id === op.working_with_id)?.name || "—"}
          </p>
          <div className="mt-2"><OverdueTags op={op} stages={stages} alertContext={alertContext}/></div>
        </button>;
      })}</div>
    </div>
    <section className="rounded-xl border border-border p-4 space-y-3">
      <h2 className="font-semibold text-sm">{selected.customer_name}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {[
          ["Stage", stages[selected.stage_id]?.name],
          ["Current Handler", person(selected.current_handler_id)],
          ["AE Owner", AE.name],
          ["Working With", teams.find(t => t.id === selected.working_with_id)?.name || "—"],
          ["Stage Aging", elapsed(selected.stage_entered_at)],
          ["Handler Aging", elapsed(selected.handler_since)],
          ["Working With Aging", elapsed(selected.working_with_since)],
          ["Status", "Open · DEMO"],
        ].map(([label, value]) => <div key={label}>
          <p className="text-muted-foreground">{label}</p><p className="font-medium mt-1">{value}</p>
        </div>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!canAct} onClick={changeStage}>เปลี่ยน Stage</Button>
        <Button size="sm" variant="outline" disabled={!canAct} onClick={handoff}>
          <ArrowLeftRight className="h-4 w-4 mr-1"/>ส่งต่อให้ {actor.id === AE.id ? "SM" : "AE"}
        </Button>
        {selected.id !== "DEMO-001" && <Button size="sm" variant="outline" disabled={!canAct}
          onClick={toggleWorkingWith}>
          {selected.working_with_id ? "นำออก" : "เพิ่ม"} Working With: {selected.id === "DEMO-002" ? "Pricer" : "Management"}
        </Button>}
      </div>
      {!canAct && <p className="text-xs text-muted-foreground">
        งานนี้อยู่กับ {person(selected.current_handler_id)} — สลับ User จำลองเพื่อแก้ไข
      </p>}
      <p className="text-[11px] text-muted-foreground">ปุ่มเหล่านี้ไม่เรียก Backend API และไม่มีการเขียน Pipeline DB / Audit Log จริง</p>
    </section>
    <section className="rounded-xl border border-border p-4 space-y-3">
      <h2 className="font-semibold text-sm flex items-center gap-2"><History className="h-4 w-4"/>Demo History</h2>
      <ol className="space-y-2">{history.map(ev => <li key={ev.id} className="border-l-2 border-border pl-3">
        <p className="text-[13px] font-medium">{ev.message}</p>
        <p className="text-xs text-muted-foreground">
          {person(ev.actor_id)} · {new Date(ev.event_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" })}
        </p>
      </li>)}</ol>
      <p className="text-[11px] text-muted-foreground">ประวัติตัวอย่างนี้ไม่ใช่ประวัติการแก้ไขที่ Backend บันทึกจริง</p>
    </section>
  </div>;
}
