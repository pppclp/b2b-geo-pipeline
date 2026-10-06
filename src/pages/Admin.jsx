import React, { useState } from "react";
import { useData } from "@/lib/dataContext";
import { ROLE_LABELS } from "@/lib/pipeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Pencil, Trash2, Plus, Check, X } from "lucide-react";

export default function Admin() {
  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto">
      <h1 className="text-xl font-semibold mb-1">Admin · Master Data</h1>
      <p className="text-sm text-muted-foreground mb-4">Configure reference data used across the pipeline.</p>
      <Tabs defaultValue="regions">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="regions">Regions</TabsTrigger>
          <TabsTrigger value="territories">Territories</TabsTrigger>
          <TabsTrigger value="stages">Stages</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
          <TabsTrigger value="lostreasons">Lost Reasons</TabsTrigger>
          <TabsTrigger value="workingwith">Working With</TabsTrigger>
          <TabsTrigger value="members">Team Members</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>

        <TabsContent value="regions"><RegionManager /></TabsContent>
        <TabsContent value="territories"><TerritoryManager /></TabsContent>
        <TabsContent value="stages"><StageManager /></TabsContent>
        <TabsContent value="categories"><CategoryManager /></TabsContent>
        <TabsContent value="products"><ProductManager /></TabsContent>
        <TabsContent value="scenarios"><SimpleManager entity="Scenario" fields={[{ key: "name", label: "Name" }, { key: "order", label: "Order", type: "number" }]} /></TabsContent>
        <TabsContent value="lostreasons"><SimpleManager entity="LostReason" fields={[{ key: "name", label: "Name" }, { key: "order", label: "Order", type: "number" }]} /></TabsContent>
        <TabsContent value="workingwith"><SimpleManager entity="WorkingWithOption" fields={[{ key: "name", label: "Name" }, { key: "order", label: "Order", type: "number" }]} /></TabsContent>
        <TabsContent value="members"><TeamMemberManager /></TabsContent>
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
  return <div className="grid grid-cols-12 gap-2 items-center py-1">{children}</div>;
}
function Header({ children }) {
  return <div className="grid grid-cols-12 gap-2 items-center py-2 border-b font-medium text-xs text-muted-foreground uppercase">{children}</div>;
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
  return (
    <Card>
      <Header><span className="col-span-4">Name</span><span className="col-span-2">Order</span><span className="col-span-2">Weight %</span><span className="col-span-2">Active</span><span className="col-span-2"></span></Header>
      {items.map((s) => (
        <Row key={s.id}>
          <Input className="col-span-4 h-8" defaultValue={s.name} onBlur={(e) => updateMaster("Stage", s.id, { name: e.target.value })} />
          <Input type="number" className="col-span-2 h-8" defaultValue={s.order} onBlur={(e) => updateMaster("Stage", s.id, { order: Number(e.target.value) })} />
          <Input type="number" className="col-span-2 h-8" defaultValue={s.weight} onBlur={(e) => updateMaster("Stage", s.id, { weight: Number(e.target.value) })} />
          <Toggle active={s.active} onToggle={(v) => updateMaster("Stage", s.id, { active: v })} />
          <span className="col-span-2 text-xs text-muted-foreground">Stages are deactivated, not deleted.</span>
        </Row>
      ))}
      <AddBar>
        <Input className="col-span-4 h-8" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button size="sm" onClick={() => { if (name) { createMaster("Stage", { name, order: items.length, active: true, weight: 0 }); setName(""); } }}><Plus className="w-4 h-4" /> Add Stage</Button>
      </AddBar>
    </Card>
  );
}

function CategoryManager() {
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

function ProductManager() {
  const { master, createMaster, updateMaster, deleteMaster } = useData();
  const items = (master?.Product || []).slice();
  const categories = (master?.ProductCategory || []).filter((c) => c.active);
  const [name, setName] = useState(""); const [catId, setCatId] = useState("");
  return (
    <Card>
      <Header><span className="col-span-6">Name</span><span className="col-span-4">Category</span><span className="col-span-1">Active</span><span className="col-span-1"></span></Header>
      {items.map((p) => (
        <Row key={p.id}>
          <Input className="col-span-6 h-8" defaultValue={p.name} onBlur={(e) => updateMaster("Product", p.id, { name: e.target.value })} />
          <Select value={p.category_id} onValueChange={(v) => updateMaster("Product", p.id, { category_id: v })}>
            <SelectTrigger className="col-span-4 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
          <Toggle active={p.active} onToggle={(v) => updateMaster("Product", p.id, { active: v })} />
          <Button variant="ghost" size="sm" className="col-span-1" onClick={() => deleteMaster("Product", p.id)}><Trash2 className="w-4 h-4 text-rose-500" /></Button>
        </Row>
      ))}
      <AddBar>
        <Input className="col-span-6 h-8" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Select value={catId} onValueChange={setCatId}><SelectTrigger className="col-span-4 h-8"><SelectValue placeholder="Category" /></SelectTrigger><SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
        <Button size="sm" onClick={() => { if (name && catId) { createMaster("Product", { name, category_id: catId, active: true }); setName(""); setCatId(""); } }}><Plus className="w-4 h-4" /></Button>
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
          <span className="col-span-2 text-xs text-muted-foreground truncate">{(m.region_ids || []).map((id) => regions.find((r) => r.id === id)?.name).filter(Boolean).join(", ") || "—"}</span>
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
        <Select value={form.app_role} onValueChange={(v) => setForm({ ...form, app_role: v })}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
        </Select>
        <div className="flex flex-wrap gap-3">
          {regions.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.region_ids.includes(r.id)} onCheckedChange={() => toggleRegion(r.id)} /> {r.name}
            </label>
          ))}
        </div>
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
  const [aging, setAging] = useState(cfg.aging_threshold_days?.value || "14");
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
          <Label>Stuck Threshold (days in stage)</Label>
          <Input type="number" value={aging} onChange={(e) => setAging(e.target.value)} onBlur={() => save("aging_threshold_days", aging)} />
          <p className="text-xs text-muted-foreground mt-1">Opportunities exceeding this stage aging are flagged as stuck.</p>
        </div>
        <div>
          <Label>Pipeline Value Metric</Label>
          <Select value={metric} onValueChange={(v) => { setMetric(v); save("pipeline_value_metric", v); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pipeline_value">pipeline_value (entered)</SelectItem>
              <SelectItem value="net_rc">net_rc (when defined)</SelectItem>
              <SelectItem value="contract_value">contract_value (when defined)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">Pending business definition. Currently uses the entered Pipeline Value.</p>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox checked={weighted} onCheckedChange={(v) => { setWeighted(!!v); save("weighted_enabled", String(!!v)); }} id="w" />
          <Label htmlFor="w">Enable Weighted Pipeline (uses stage weights)</Label>
        </div>
      </div>
    </Card>
  );
}

function Card({ children }) {
  return <div className="rounded-lg border border-border bg-card p-4">{children}</div>;
}
function AddBar({ children }) {
  return <div className="grid grid-cols-12 gap-2 items-center mt-3 pt-3 border-t">{children}</div>;
}
function Toggle({ active, onToggle }) {
  return (
    <button className="col-span-2 flex justify-start" onClick={() => onToggle(!active)}>
      {active ? <Check className="w-4 h-4 text-emerald-600" /> : <X className="w-4 h-4 text-muted-foreground" />}
    </button>
  );
}