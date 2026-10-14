import React, { useState } from "react";
import { useData } from "@/lib/dataContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "__none__";
const parseOptionalDays = (v) => v === "" ? null : Number(v);

function DaysInput({ value, onSave }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  React.useEffect(() => { setDraft(value == null ? "" : String(value)); }, [value]);
  return <Input type="number" min="1" step="1" aria-label="SLA days" className="w-24"
    placeholder="Not set" value={draft} onChange={(e) => setDraft(e.target.value)}
    onBlur={() => {
      const number = parseOptionalDays(draft);
      if (number !== null && (!Number.isSafeInteger(number) || number <= 0)) { setDraft(value == null ? "" : String(value)); return; }
      if (number !== (value ?? null)) onSave(number);
    }} />;
}

export function StageSlaManager() {
  const { master, createMaster, updateMaster, config } = useData();
  const rules = master?.StageSLA || [];
  const stages = (master?.Stage || []).filter((s) => s.active).sort((a,b) => (a.order||0)-(b.order||0));
  return <div className="space-y-4">
    <h2 className="text-lg font-semibold">Stage SLA</h2>
    <p className="text-sm text-muted-foreground">Blank uses the current global threshold ({config.aging_threshold_days} calendar days). Business-day Stage SLA requires a holiday calendar before overdue alerts can run.</p>
    <div className="divide-y rounded-xl border">
      {stages.map((stage) => {
        const rule = rules.find((r) => r.stage_id === stage.id);
        const patch = (values) => rule ? updateMaster("StageSLA",rule.id,values) :
          createMaster("StageSLA",{stage_id:stage.id, day_type:"calendar",active:true, ...values});
        return <div key={stage.id} className="grid sm:grid-cols-[1fr_110px_145px] items-center gap-3 p-3">
          <div><div className="font-medium">{stage.name}</div><div className="text-xs text-muted-foreground">{stage.id}</div></div>
          <DaysInput value={rule?.sla_days} onSave={(sla_days)=>patch({sla_days})}/>
          <Select value={rule?.day_type || "calendar"} onValueChange={(day_type)=>patch({day_type})}>
            <SelectTrigger aria-label={stage.name+" day type"}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="calendar">Calendar days</SelectItem><SelectItem value="business">Business days</SelectItem></SelectContent>
          </Select>
        </div>;
      })}
    </div>
  </div>;
}

export function ActionSlaManager() {
  const { master, createMaster, updateMaster } = useData();
  const rows = (master?.ActionSLA || []).slice().sort((a,b)=>(a.process_key||"").localeCompare(b.process_key||"") || (a.order||0)-(b.order||0));
  const teams = (master?.WorkingWithOption || []).filter((t)=>t.active);
  const scenarios = (master?.Scenario || []).filter((s)=>s.active);
  const [draft,setDraft]=useState({ process_key:"",action_name:"",order:1,scenario_id:"",working_with_id:"",approval_level:"",sla_days:"",day_type:"business" });
  const set=(key,value)=>setDraft((v)=>({...v,[key]:value}));
  const add=async()=>{
    if (!draft.process_key.trim() || !draft.action_name.trim()) return;
    const sla_days=parseOptionalDays(draft.sla_days);
    if (sla_days!==null && (!Number.isSafeInteger(sla_days)||sla_days<=0)) return;
    await createMaster("ActionSLA",{...draft,process_key:draft.process_key.trim(),action_name:draft.action_name.trim(),sla_days,order:Number(draft.order)||0,active:true});
    setDraft({ process_key:"",action_name:"",order:1,scenario_id:"",working_with_id:"",approval_level:"",sla_days:"",day_type:"business" });
  };
  return <div className="space-y-4">
    <h2 className="text-lg font-semibold">Action SLA</h2>
    <p className="text-sm text-muted-foreground">Configure each process and step. Working With is optional. The total approval period is not added to its steps. These are definitions only; action timing and alerts require action start/finish records and a holiday calendar.</p>
    <div className="divide-y rounded-xl border">
      {rows.map((r)=><div key={r.id} className="p-3 grid sm:grid-cols-[1fr_125px_145px_155px] items-center gap-3">
        <div className="min-w-0">
          <div className="font-medium text-sm">{r.action_name}</div>
          <div className="text-xs text-muted-foreground">{r.process_key} · {r.approval_level || r.id}</div>
        </div>
        <DaysInput value={r.sla_days} onSave={(sla_days)=>updateMaster("ActionSLA",r.id,{sla_days})}/>
        <Select value={r.day_type || "business"} onValueChange={(day_type)=>updateMaster("ActionSLA",r.id,{day_type})}>
          <SelectTrigger aria-label="Day type"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="calendar">Calendar days</SelectItem><SelectItem value="business">Business days</SelectItem></SelectContent>
        </Select>
        <Select value={r.working_with_id || NONE} onValueChange={(v)=>updateMaster("ActionSLA",r.id,{working_with_id:v===NONE?"":v})}>
          <SelectTrigger aria-label="Working With"><SelectValue placeholder="No team" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No team</SelectItem>
            {teams.map((t)=><SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>)}
      {rows.length===0 && <p className="p-4 text-sm text-muted-foreground">No Action SLA configured.</p>}
    </div>
    <div className="rounded-xl border p-4 space-y-3">
      <h3 className="font-medium">Add Action</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div><Label>Process Key *</Label><Input value={draft.process_key} onChange={(e)=>set("process_key",e.target.value)} placeholder="e.g. CUSTOM_APPROVAL"/></div>
        <div><Label>Action Name *</Label><Input value={draft.action_name} onChange={(e)=>set("action_name",e.target.value)}/></div>
        <div><Label>Step Order</Label><Input type="number" min="0" value={draft.order} onChange={(e)=>set("order",e.target.value)}/></div>
        <div><Label>SLA (days)</Label><Input type="number" min="1" value={draft.sla_days} onChange={(e)=>set("sla_days",e.target.value)} placeholder="No SLA"/></div>
        <div><Label>Scenario</Label><Select value={draft.scenario_id || NONE} onValueChange={(v)=>set("scenario_id",v===NONE?"":v)}><SelectTrigger><SelectValue placeholder="Any"/></SelectTrigger><SelectContent><SelectItem value={NONE}>Any</SelectItem>{scenarios.map((s)=><SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Working With</Label><Select value={draft.working_with_id || NONE} onValueChange={(v)=>set("working_with_id",v===NONE?"":v)}><SelectTrigger><SelectValue placeholder="No team"/></SelectTrigger><SelectContent><SelectItem value={NONE}>No team</SelectItem>{teams.map((t)=><SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Approval Level</Label><Input value={draft.approval_level} onChange={(e)=>set("approval_level",e.target.value)} placeholder="Optional"/></div>
        <div><Label>Day Type</Label><Select value={draft.day_type} onValueChange={(v)=>set("day_type",v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="calendar">Calendar days</SelectItem><SelectItem value="business">Business days</SelectItem></SelectContent></Select></div>
      </div>
      <Button disabled={!draft.process_key.trim()||!draft.action_name.trim()} onClick={add}>Add Action</Button>
    </div>
  </div>;
}
