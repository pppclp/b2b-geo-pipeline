import React, { useState } from "react";
import { useData } from "@/lib/dataContext";
import { ROLE_LABELS, formatTHB, formatMonth, formatDateTime, currentMonthKey } from "@/lib/pipeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import MonthPicker from "@/components/MonthPicker";
import { Trash2, Plus, Check, X, Download, Camera } from "lucide-react";
import SheetEditor from "@/components/SheetEditor";
import { db } from "@/api/client";
import { downloadPipelineExcel } from "@/lib/pipelineExport";
import { safeCsvTable } from "@/lib/safeCsv";

export default function Admin() {
  const { profile } = useData();
  if (profile?.app_role !== "admin") {
    return (
      <div className="p-10 max-w-[600px] mx-auto text-center">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Admin</h1>
        <p className="text-sm text-muted-foreground">Master data management is restricted to Admin users.</p>
      </div>
    );
  }
  return (
    <div className="p-5 md:p-7 max-w-[1200px] mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Admin · Master Data</h1>
      <p className="text-sm text-muted-foreground mb-5">Configure reference data used across the pipeline.</p>
      <Tabs defaultValue="sheets">
        <TabsList className="flex flex-wrap h-auto bg-secondary rounded-xl p-1 mb-5">
          <TabsTrigger value="sheets">Source Sheets</TabsTrigger>
          <TabsTrigger value="regions">Regions</TabsTrigger>
          <TabsTrigger value="territories">Territories</TabsTrigger>
          <TabsTrigger value="stages">Stages</TabsTrigger>
          <TabsTrigger value="categories">Product Categories</TabsTrigger>
          <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
          <TabsTrigger value="lostreasons">Lost Reasons</TabsTrigger>
          <TabsTrigger value="workingwith">Working With</TabsTrigger>
          <TabsTrigger value="members">Team Members</TabsTrigger>
          <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
          <TabsTrigger value="exports">Exports</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>

        <TabsContent value="sheets"><SheetEditor /></TabsContent>
        <TabsContent value="regions"><RegionManager /></TabsContent>
        <TabsContent value="territories"><TerritoryManager /></TabsContent>
        <TabsContent value="stages"><StageManager /></TabsContent>
        <TabsContent value="categories"><CategoryManager /></TabsContent>
        <TabsContent value="scenarios"><SimpleManager entity="Scenario" fields={[{ key: "name", label: "Name" }, { key: "order", label: "Order", type: "number" }]} /></TabsContent>
        <TabsContent value="lostreasons"><SimpleManager entity="LostReason" fields={[{ key: "name", label: "Name" }, { key: "order", label: "Order", type: "number" }]} /></TabsContent>
        <TabsContent value="workingwith"><SimpleManager entity="WorkingWithOption" fields={[{ key: "name", label: "Name" }, { key: "order", label: "Order", type: "number" }]} /></TabsContent>
        <TabsContent value="members"><TeamMemberManager /></TabsContent>
        <TabsContent value="snapshots"><SnapshotManager /></TabsContent>
        <TabsContent value="exports"><ExportsManager /></TabsContent>
        <TabsContent value="config"><ConfigManager /></TabsContent>
      </Tabs>
    </div>
  );
}

function useMaster(entity) {
  const { master, createMaster, updateMaster, deleteMaster } = useData();
  return { items: (master?.[entity] || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), createMaster, updateMaster, deleteMaster };
}

function Row({ children }) {
  return <div className="grid grid-cols-12 gap-2 items-center py-1.5">{children}</div>;
}
function Header({ children }) {
  return <div className="grid grid-cols-12 gap-2 items-center py-2.5 border-b border-border font-medium text-[10px] text-muted-foreground uppercase tracking-wide">{children}</div>;
}

function RegionManager() {
  const { items, createMaster, updateMaster } = useMaster("Region");
  const [name, setName] = useState(""); const [code, setCode] = useState("");
  return (
    <Card>
      <Header><span className="col-span-5">Name</span><span className="col-span-3">Code</span><span className="col-span-2">Order</span><span className="col-span-2">Active</span></Header>
      {items.map((r) => (
        <Row key={r.id}>
          <Input className="col-span-5 h-8" defaultValue={r.name} onBlur={(e) => updateMaster("Region", r.id, { name: e.target.value })} />
          <Input className="col-span-3 h-8" defaultValue={r.code} onBlur={(e) => updateMaster("Region", r.id, { code: e.target.value })} />
          <Input type="number" className="col-span-2 h-8" defaultValue={r.order} onBlur={(e) => updateMaster("Region", r.id, { order: Number(e.target.value) })} />
          <Toggle active={r.active} onToggle={(v) => updateMaster("Region", r.id, { active: v })} />
        </Row>
      ))}
      <AddBar>
        <Input className="col-span-5 h-8" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input className="col-span-3 h-8" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
        <Button size="sm" onClick={() => { createMaster("Region", { name, code, order: items.length, active: true }); setName(""); setCode(""); }}><Plus className="w-4 h-4" /></Button>
      </AddBar>
    </Card>
  );
}

function TerritoryManager() {
  const { master, createMaster, updateMaster, deleteMaster } = useData();
  const items = (master?.Territory || []).slice();
  const regions = (master?.Region || []).filter((r) => r.active);
  const [name, setName] = useState(""); const [regionId, setRegionId] = useState("");
  return (
    <Card>
      <Header><span className="col-span-5">Name</span><span className="col-span-4">Region</span><span className="col-span-2">Active</span><span className="col-span-1"></span></Header>
      {items.map((t) => (
        <Row key={t.id}>
          <Input className="col-span-5 h-8" defaultValue={t.name} onBlur={(e) => updateMaster("Territory", t.id, { name: e.target.value })} />
          <Select value={t.region_id} onValueChange={(v) => updateMaster("Territory", t.id, { region_id: v })}>
            <SelectTrigger className="col-span-4 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{regions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
          <Toggle active={t.active} onToggle={(v) => updateMaster("Territory", t.id, { active: v })} />
          <Button variant="ghost" size="sm" className="col-span-1" onClick={() => deleteMaster("Territory", t.id)}><Trash2 className="w-4 h-4 text-rose-500" /></Button>
        </Row>
      ))}
      <AddBar>
        <Input className="col-span-5 h-8" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Select value={regionId} onValueChange={setRegionId}><SelectTrigger className="col-span-4 h-8"><SelectValue placeholder="Region" /></SelectTrigger><SelectContent>{regions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select>
        <Button size="sm" onClick={() => { if (name && regionId) { createMaster("Territory", { name, region_id: regionId, active: true }); setName(""); setRegionId(""); } }}><Plus className="w-4 h-4" /></Button>
      </AddBar>
    </Card>
  );
}

function StageManager() {
  const { items, createMaster, updateMaster } = useMaster("Stage");
  const [name, setName] = useState("");
  const [newSla, setNewSla] = useState("");
  const validDays = (v) => v === "" || (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 365);
  const saveSla = (stage, input) => {
    const value = input.value.trim();
    if (!validDays(value)) {
      input.value = stage.sla_days ?? "";
      return;
    }
    updateMaster("Stage", stage.id, { sla_days: value === "" ? null : Number(value) });
  };
  return (
    <Card>
      <p className="text-xs text-muted-foreground mb-3">
        Set a Stage SLA in calendar days (1–365). Blank means not configured and will not be flagged overdue.
        Internal Working With SLA is configured separately under Config.
      </p>
      <Header><span className="col-span-3">Stage</span><span className="col-span-2">Order</span><span className="col-span-2">Weight %</span><span className="col-span-2">SLA (days)</span><span className="col-span-1">Active</span><span className="col-span-2"></span></Header>
      {items.map((s) => (
        <Row key={s.id}>
          <Input className="col-span-3 h-8" defaultValue={s.name} onBlur={(e) => updateMaster("Stage", s.id, { name: e.target.value })} />
          <Input type="number" className="col-span-2 h-8" defaultValue={s.order} onBlur={(e) => updateMaster("Stage", s.id, { order: Number(e.target.value) })} />
          <Input type="number" className="col-span-2 h-8" defaultValue={s.weight} onBlur={(e) => updateMaster("Stage", s.id, { weight: Number(e.target.value) })} />
          <Input type="number" min="1" max="365" step="1" className="col-span-2 h-8" defaultValue={s.sla_days ?? ""} onBlur={(e) => saveSla(s, e.target)} placeholder="Not set" />
          <div className="col-span-1"><Toggle active={s.active} onToggle={(v) => updateMaster("Stage", s.id, { active: v })} /></div>
          <span className="col-span-2 text-xs text-muted-foreground">Deactivate; do not delete</span>
        </Row>
      ))}
      <AddBar>
        <Input className="col-span-3 h-8" placeholder="New Stage" value={name} onChange={(e) => setName(e.target.value)} />
        <Input type="number" min="1" max="365" step="1" className="col-span-2 h-8" value={newSla} onChange={(e) => setNewSla(e.target.value)} placeholder="SLA days" />
        <Button size="sm" disabled={!name.trim() || !validDays(newSla)} onClick={() => {
          createMaster("Stage", { name: name.trim(), order: items.length, active: true, weight: 0, sla_days: newSla === "" ? null : Number(newSla) });
          setName(""); setNewSla("");
        }}><Plus className="w-4 h-4" /> Add Stage</Button>
      </AddBar>
    </Card>
  );
}

function CategoryManager() {
  // Product categories live in Pipeline Config; free-text Product Details do not need a master.
  const { items, createMaster, updateMaster } = useMaster("ProductCategory");
  const [name, setName] = useState("");
  return (
    <Card>
      <Header><span className="col-span-6">Name</span><span className="col-span-2">Order</span><span className="col-span-2">Active</span><span className="col-span-2"></span></Header>
      {items.map((c) => (
        <Row key={c.id}>
          <Input className="col-span-6 h-8" defaultValue={c.name} onBlur={(e) => updateMaster("ProductCategory", c.id, { name: e.target.value })} />
          <Input type="number" className="col-span-2 h-8" defaultValue={c.order} onBlur={(e) => updateMaster("ProductCategory", c.id, { order: Number(e.target.value) })} />
          <Toggle active={c.active} onToggle={(v) => updateMaster("ProductCategory", c.id, { active: v })} />
          <span className="col-span-2 text-xs text-muted-foreground">Deactivate only</span>
        </Row>
      ))}
      <AddBar>
        <Input className="col-span-6 h-8" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button size="sm" onClick={() => { if (name) { createMaster("ProductCategory", { name, order: items.length, active: true }); setName(""); } }}><Plus className="w-4 h-4" /> Add</Button>
      </AddBar>
    </Card>
  );
}

function SimpleManager({ entity, fields }) {
  const { items, createMaster, updateMaster } = useMaster(entity);
  const [vals, setVals] = useState({});
  return (
    <Card>
      <Header>
        {fields.map((f) => <span key={f.key} className={`col-span-${f.type === "number" ? 2 : 6}`}>{f.label}</span>)}
        <span className="col-span-2">Active</span>
        <span className="col-span-2"></span>
      </Header>
      {items.map((it) => (
        <Row key={it.id}>
          {fields.map((f) => (
            <Input key={f.key} type={f.type || "text"} className={`col-span-${f.type === "number" ? 2 : 6} h-8`} defaultValue={it[f.key]} onBlur={(e) => updateMaster(entity, it.id, { [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value })} />
          ))}
          <Toggle active={it.active} onToggle={(v) => updateMaster(entity, it.id, { active: v })} />
          <span className="col-span-2 text-xs text-muted-foreground">Deactivate only</span>
        </Row>
      ))}
      <AddBar>
        {fields.map((f) => (
          <Input key={f.key} type={f.type || "text"} className={`col-span-${f.type === "number" ? 2 : 6} h-8`} placeholder={f.label} value={vals[f.key] || ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
        ))}
        <Button size="sm" onClick={() => { const data = { ...vals, active: true, order: items.length }; fields.forEach((f) => { if (f.type === "number") data[f.key] = Number(data[f.key]) || 0; }); createMaster(entity, data); setVals({}); }}><Plus className="w-4 h-4" /></Button>
      </AddBar>
    </Card>
  );
}

function TeamMemberManager() {
  const { master, createMaster, updateMaster } = useData();
  const items = (master?.TeamMember || []).slice();
  const regions = (master?.Region || []).filter((r) => r.active);
  const [form, setForm] = useState({ name: "", email: "", title: "", app_role: "ae", region_ids: [] });

  const toggleRegion = (id) => setForm((f) => ({ ...f, region_ids: f.region_ids.includes(id) ? f.region_ids.filter((x) => x !== id) : [...f.region_ids, id] }));

  return (
    <Card>
      <Header><span className="col-span-3">Name</span><span className="col-span-3">Email</span><span className="col-span-2">Role</span><span className="col-span-2">Regions</span><span className="col-span-2">Active</span></Header>
      {items.map((m) => (
        <Row key={m.id}>
          <Input className="col-span-3 h-8" defaultValue={m.name} onBlur={(e) => updateMaster("TeamMember", m.id, { name: e.target.value })} />
          <Input className="col-span-3 h-8" defaultValue={m.email} onBlur={(e) => updateMaster("TeamMember", m.id, { email: e.target.value })} />
          <Select value={m.app_role} onValueChange={(v) => updateMaster("TeamMember", m.id, { app_role: v })}>
            <SelectTrigger className="col-span-2 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
          <span className="col-span-2 text-xs text-muted-foreground truncate">{["management", "admin"].includes(m.app_role)
            ? "All Regions (by role)"
            : (m.region_ids || []).map((id) => regions.find((r) => r.id === id)?.name).filter(Boolean).join(", ") || "—"}</span>
          <Toggle active={m.active} onToggle={(v) => updateMaster("TeamMember", m.id, { active: v })} />
        </Row>
      ))}
      <div className="mt-4 border-t pt-3 space-y-2">
        <div className="text-sm font-medium">Add Team Member</div>
        <div className="grid grid-cols-3 gap-2">
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Email (matches login)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <Select value={form.app_role} onValueChange={(v) => setForm({ ...form, app_role: v, region_ids: ["management","admin"].includes(v) ? [] : form.region_ids })}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
        </Select>
        {["management","admin"].includes(form.app_role) ? (
          <p className="text-xs text-muted-foreground">All Regions are available by role. No manual Region mapping is required.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {regions.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.region_ids.includes(r.id)} onCheckedChange={() => toggleRegion(r.id)} /> {r.name}
              </label>
            ))}
          </div>
        )}
        <Button size="sm" onClick={() => { if (form.name) { createMaster("TeamMember", { ...form, active: true }); setForm({ name: "", email: "", title: "", app_role: "ae", region_ids: [] }); } }}>
          <Plus className="w-4 h-4 mr-1" /> Add Member
        </Button>
      </div>
    </Card>
  );
}

function ConfigManager() {
  const { master, createMaster, updateMaster } = useData();
  const cfg = Object.fromEntries((master?.AppConfig || []).map((c) => [c.key, c]));
  const [internalSla, setInternalSla] = useState(cfg.internal_task_sla_days?.value ?? "");
  const [stageWatch, setStageWatch] = useState(cfg.stage_watch_days?.value ?? "7");
  const [metric, setMetric] = useState(cfg.pipeline_value_metric?.value || "pipeline_value");
  const [weighted, setWeighted] = useState(cfg.weighted_enabled?.value === "true");

  const save = (key, value) => {
    if (cfg[key]) updateMaster("AppConfig", cfg[key].id, { value });
    else createMaster("AppConfig", { key, value });
  };

  return (
    <Card>
      <div className="space-y-4 max-w-md">
        <div>
          <Label>Stage Aging Warning (calendar days)</Label>
          <Input type="number" min="1" max="365" step="1" value={stageWatch}
            onChange={(e) => setStageWatch(e.target.value)}
            onBlur={() => {
              const next = String(stageWatch).trim();
              if (!/^\d+$/.test(next) || Number(next) < 1 || Number(next) > 365) {
                setStageWatch(cfg.stage_watch_days?.value ?? "7");
                return;
              }
              if (next !== String(cfg.stage_watch_days?.value ?? "7")) save("stage_watch_days", next);
            }} />
          <p className="text-xs text-muted-foreground mt-1">Warning when an Open Pipeline stays in the current Stage beyond this limit. Independent from Stage SLA and Task SLA.</p>
        </div>
        <div>
          <Label>Internal Working With SLA (calendar days)</Label>
          <Input type="number" min="1" max="365" step="1" value={internalSla} onChange={(e) => setInternalSla(e.target.value)} onBlur={() => {
            const v = internalSla.trim();
            if (v !== "" && (!Number.isInteger(Number(v)) || Number(v) < 1 || Number(v) > 365)) {
              setInternalSla(cfg.internal_task_sla_days?.value ?? "");
              return;
            }
            if (v !== String(cfg.internal_task_sla_days?.value ?? "")) save("internal_task_sla_days", v);
          }} placeholder="Not configured" />
          <p className="text-xs text-muted-foreground mt-1">Starts when Working With is selected. Independent of Stage and Handler aging; blank disables this alert.</p>
        </div>
        <div>
          <Label>Pipeline Value Metric</Label>
          <Select disabled value={metric} onValueChange={(v) => { setMetric(v); save("pipeline_value_metric", v); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pipeline_value">pipeline_value (entered)</SelectItem>
              <SelectItem value="net_rc">net_rc (when defined)</SelectItem>
              <SelectItem value="contract_value">contract_value (when defined)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">Pending business definition (business_decisions_pending in the YAML). Currently uses the entered Pipeline Value.</p>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox disabled checked={weighted} onCheckedChange={(v) => { setWeighted(!!v); save("weighted_enabled", String(!!v)); }} id="w" />
          <Label htmlFor="w">Enable Weighted Pipeline (uses stage weights) — not stored in a source sheet yet</Label>
        </div>
      </div>
    </Card>
  );
}

function SnapshotManager() {
  const { master, maps, captureSnapshot } = useData();
  const [month, setMonth] = useState(currentMonthKey());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const snapshots = (master?.MonthlySnapshot || []).slice();
  const byMonth = {};
  snapshots.forEach((s) => { (byMonth[s.snapshot_period] = byMonth[s.snapshot_period] || []).push(s); });
  const months = Object.keys(byMonth).sort().reverse();

  const capture = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await captureSnapshot(month);
      setMsg(`Captured ${res.captured} opportunity snapshots for ${formatMonth(month)}.${res.warning ? " " + res.warning : ""}`);
    } catch (e) { setMsg("Capture failed: " + (e.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <div className="space-y-4">
        <div>
          <Label>Capture month-end snapshot for</Label>
          <div className="flex items-end gap-2 mt-1">
            <MonthPicker value={month} onChange={setMonth} className="w-[180px]" />
            <Button size="sm" onClick={capture} disabled={busy}><Camera className="w-4 h-4 mr-1" /> {busy ? "Capturing…" : "Capture Snapshot"}</Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Captures the current state of all open/won/lost opportunities. Re-capturing a month replaces its previous snapshot. Used for month-end history comparison.</p>
          {msg && <p className="text-sm mt-2">{msg}</p>}
        </div>
        <div className="border-t pt-3">
          <h3 className="text-sm font-medium mb-2">Existing Snapshots</h3>
          {months.length === 0 ? (
            <p className="text-sm text-muted-foreground">No snapshots captured yet.</p>
          ) : (
            <div className="space-y-2">
              {months.map((m) => {
                const rows = byMonth[m];
                const value = rows.reduce((a, s) => a + (s.pipeline_value || 0), 0);
                return (
                  <div key={m} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{formatMonth(m)}</span>
                    <span className="text-muted-foreground tabular-nums">{rows.length} opportunities · {formatTHB(value)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function ExportsManager() {
  const { scopedOpportunities, maps, master } = useData();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const download = (name, headers, rows) => {
    const csv = safeCsvTable(headers, rows);
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportChangeLog = async () => {
    setExportError("");
    setExporting(true);
    try {
    const history = await db.entities.OpportunityHistory.list("-created_date");
    const headers = ["Event At", "Opportunity ID", "Customer", "Event Type", "Field", "Previous Value", "New Value", "Actor", "Remark"];
    const rows = history
      .slice()
      .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
      .map((h) => {
        const op = scopedOpportunities.find((o) => o.id === h.opportunity_id);
        return [
          formatDateTime(h.created_date), h.opportunity_id, op?.customer_name || "",
          h.event_type, h.field || "", h.previous_value || "", h.new_value || "",
          h.actor_name || "", h.remark || "",
        ];
      });
    download("change_log", headers, rows);
    } catch (e) {
      setExportError(e.message || "Change Log export failed");
    } finally {
      setExporting(false);
    }
  };

  const exportCurrentExcel = async () => {
    setExportError("");
    setExporting(true);
    try {
      // The Admin UI uses the exact same server-authorized exporter as Pipeline.
      const authorized = await db.exports.pipelines();
      await downloadPipelineExcel(authorized, maps);
    } catch (error) {
      setExportError(error.message || "Excel export failed");
    } finally {
      setExporting(false);
    }
  };

  const snapshotCount = (master?.MonthlySnapshot || []).length;

  return (
    <Card>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium text-sm">Change Log Export</div>
            <p className="text-xs text-muted-foreground">Authorized opportunity events, loaded only when exporting. CSV, one row per event.</p>
          </div>
          <Button variant="outline" size="sm" onClick={exportChangeLog} disabled={exporting}><Download className="w-4 h-4 mr-1" /> Export Change Log</Button>
        </div>
        <div className="border-t pt-3 flex items-center justify-between gap-3">
          <div>
            <div className="font-medium text-sm">Current Pipeline Export</div>
            <p className="text-xs text-muted-foreground">Current pipeline ({scopedOpportunities.length} visible opportunities) as an Excel workbook. Month-end captures remain in the Snapshots tab.</p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCurrentExcel} disabled={exporting}><Download className="w-4 h-4 mr-1" /> {exporting ? "Generating…" : "Export Excel"}</Button>
        </div>
        {exportError && <p role="alert" className="text-sm text-red-600">{exportError}</p>}
        <div className="border-t pt-3 text-xs text-muted-foreground">
          {snapshotCount > 0 ? `${snapshotCount} snapshot rows stored (see Snapshots tab).` : "No snapshots stored yet."}
          <span className="block mt-1">Change Log remains CSV; Pipeline export is .xlsx.</span>
        </div>
      </div>
    </Card>
  );
}

function Card({ children }) {
  return <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">{children}</div>;
}
function AddBar({ children }) {
  return <div className="grid grid-cols-12 gap-2 items-center mt-4 pt-4 border-t border-border">{children}</div>;
}
function Toggle({ active, onToggle }) {
  return (
    <button className="col-span-2 flex justify-start" onClick={() => onToggle(!active)}>
      {active ? <Check className="w-4 h-4 text-emerald-600" /> : <X className="w-4 h-4 text-muted-foreground" />}
    </button>
  );
}