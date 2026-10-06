import React, { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useData } from "@/lib/dataContext";
import { CUSTOMER_TYPES, SUPPORT_TYPES } from "@/lib/pipeline";
import MonthPicker from "@/components/MonthPicker";
import SearchableSelect from "@/components/SearchableSelect";

const empty = {
  customer_name: "",
  business_id: "",
  customer_type: "",
  region_id: "",
  territory_id: "",
  owner_id: "",
  current_handler_id: "",
  product_category_id: "",
  product_id: "",
  stage_id: "",
  expected_close_month: "",
  pipeline_value: "",
  scenario_id: "",
  quantity: "",
  rc: "",
  oc: "",
  discount: "",
  contract_period: "",
  working_with: "",
  support_needed: false,
  support_type: "",
  support_note: "",
};

export default function OpportunityForm({ open, onClose, opportunity, onSaved }) {
  const { maps, master, activeStages, profile, createOpportunity, updateWithHistory } = useData();
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (opportunity) {
      setForm({ ...empty, ...opportunity });
    } else {
      const first = activeStages[0];
      setForm({
        ...empty,
        owner_id: profile?.app_role === "ae" ? profile.id : "",
        current_handler_id: profile?.app_role === "ae" ? profile.id : "",
        stage_id: first?.id || "",
        region_id: profile?.region_ids?.[0] || "",
      });
    }
  }, [opportunity, open, activeStages, profile]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const regionOptions = useMemo(
    () => (master?.Region || []).filter((r) => r.active).sort((a, b) => a.order - b.order).map((r) => ({ value: r.id, label: r.name })),
    [master]
  );
  const territoryOptions = useMemo(
    () => (master?.Territory || []).filter((t) => t.active && t.region_id === form.region_id).map((t) => ({ value: t.id, label: t.name })),
    [master, form.region_id]
  );
  const memberOptions = useMemo(
    () => (master?.TeamMember || []).filter((m) => m.active).map((m) => ({ value: m.id, label: `${m.name} (${m.app_role.toUpperCase()})` })),
    [master]
  );
  const categoryOptions = useMemo(
    () => (master?.ProductCategory || []).filter((c) => c.active).sort((a, b) => a.order - b.order).map((c) => ({ value: c.id, label: c.name })),
    [master]
  );
  const productOptions = useMemo(
    () => (master?.Product || []).filter((p) => p.active && p.category_id === form.product_category_id).map((p) => ({ value: p.id, label: p.name })),
    [master, form.product_category_id]
  );
  const scenarioOptions = useMemo(
    () => (master?.Scenario || []).filter((s) => s.active).sort((a, b) => a.order - b.order).map((s) => ({ value: s.id, label: s.name })),
    [master]
  );
  const workingWithOptions = useMemo(
    () => (master?.WorkingWithOption || []).filter((w) => w.active).map((w) => ({ value: w.name, label: w.name })),
    [master]
  );

  const valid = form.customer_name && form.region_id && form.owner_id && form.product_category_id && form.stage_id && Number(form.pipeline_value) >= 0;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const { id, created_date, updated_date, created_by_id, ...rest } = form;
      const payload = {
        ...rest,
        pipeline_value: Number(form.pipeline_value) || 0,
        quantity: form.quantity ? Number(form.quantity) : null,
        rc: form.rc ? Number(form.rc) : null,
        oc: form.oc ? Number(form.oc) : null,
        discount: form.discount ? Number(form.discount) : null,
        contract_period: form.contract_period ? Number(form.contract_period) : null,
        current_handler_id: form.current_handler_id || form.owner_id,
      };
      if (opportunity) {
        await updateWithHistory(opportunity.id, payload, null);
      } else {
        await createOpportunity(payload);
      }
      onSaved?.();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{opportunity ? "Edit Opportunity" : "New Opportunity"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
          <div className="sm:col-span-2">
            <Label>Customer Name *</Label>
            <Input value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} placeholder="e.g. PTT Public Company Limited" />
          </div>

          <div>
            <Label>Business ID</Label>
            <Input value={form.business_id} onChange={(e) => set("business_id", e.target.value)} placeholder="Tax ID / ref" />
          </div>
          <div>
            <Label>Customer Type</Label>
            <Select value={form.customer_type} onValueChange={(v) => set("customer_type", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {CUSTOMER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Region *</Label>
            <Select value={form.region_id} onValueChange={(v) => set("region_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {regionOptions.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Territory</Label>
            <Select value={form.territory_id} onValueChange={(v) => set("territory_id", v)} disabled={!form.region_id}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {territoryOptions.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Opportunity Owner *</Label>
            <Select value={form.owner_id} onValueChange={(v) => set("owner_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {memberOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Current Handler</Label>
            <Select value={form.current_handler_id} onValueChange={(v) => set("current_handler_id", v)}>
              <SelectTrigger><SelectValue placeholder="Defaults to owner" /></SelectTrigger>
              <SelectContent>
                {memberOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Product Category *</Label>
            <Select value={form.product_category_id} onValueChange={(v) => { set("product_category_id", v); set("product_id", ""); }}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {categoryOptions.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Product</Label>
            <SearchableSelect
              value={form.product_id}
              onChange={(v) => set("product_id", v)}
              options={productOptions}
              placeholder="Select product"
              disabled={!form.product_category_id}
            />
          </div>

          <div>
            <Label>Stage *</Label>
            <Select value={form.stage_id} onValueChange={(v) => set("stage_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {activeStages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Expected Close Month</Label>
            <MonthPicker value={form.expected_close_month} onChange={(v) => set("expected_close_month", v)} />
          </div>

          <div>
            <Label>Pipeline Value (฿) *</Label>
            <Input type="number" value={form.pipeline_value} onChange={(e) => set("pipeline_value", e.target.value)} placeholder="0" />
          </div>
          <div>
            <Label>Scenario</Label>
            <Select value={form.scenario_id} onValueChange={(v) => set("scenario_id", v)}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                {scenarioOptions.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Quantity</Label>
            <Input type="number" value={form.quantity ?? ""} onChange={(e) => set("quantity", e.target.value)} />
          </div>
          <div>
            <Label>RC (recurring)</Label>
            <Input type="number" value={form.rc ?? ""} onChange={(e) => set("rc", e.target.value)} />
          </div>
          <div>
            <Label>OC (one-time)</Label>
            <Input type="number" value={form.oc ?? ""} onChange={(e) => set("oc", e.target.value)} />
          </div>
          <div>
            <Label>Discount (%)</Label>
            <Input type="number" value={form.discount ?? ""} onChange={(e) => set("discount", e.target.value)} />
          </div>
          <div>
            <Label>Contract Period (months)</Label>
            <Input type="number" value={form.contract_period ?? ""} onChange={(e) => set("contract_period", e.target.value)} />
          </div>

          <div>
            <Label>Working With</Label>
            <Select value={form.working_with} onValueChange={(v) => set("working_with", v)}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>—</SelectItem>
                {workingWithOptions.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t">
          <Switch checked={form.support_needed} onCheckedChange={(v) => set("support_needed", v)} />
          <Label className="cursor-pointer">Support Needed</Label>
        </div>
        {form.support_needed && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Support Type</Label>
              <Select value={form.support_type} onValueChange={(v) => set("support_type", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {SUPPORT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Support Note</Label>
              <Textarea value={form.support_note} onChange={(e) => set("support_note", e.target.value)} rows={2} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || saving}>
            {saving ? "Saving…" : opportunity ? "Save Changes" : "Create Opportunity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}