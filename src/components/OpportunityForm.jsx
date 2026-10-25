import React, { useState, useMemo, useEffect } from "react";
import CreatePipelineModal from "@/components/CreatePipelineModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useData } from "@/lib/dataContext";
import { CUSTOMER_TYPES, formatMonth } from "@/lib/pipeline";
import { calculateNetRc, formatNetRc } from "@/lib/netRc";
import MonthPicker from "@/components/MonthPicker";
import WorkingWithMultiSelect from "@/components/WorkingWithMultiSelect";

const empty = {
  customer_name: "",
  business_id: "",
  customer_type: "",
  sales_channel: "",
  partner_name: "",
  contact_name: "",
  contact_phone: "",
  remark: "",
  product_details: "",
  ccp_check_result: "",
  region_id: "",
  territory_id: "",
  owner_id: "",
  current_handler_id: "",
  product_category_id: "",
  stage_id: "",
  expected_close_month: "",
  pipeline_value: "",
  price_per_sub: "",
  scenario_id: "",
  quantity: "",
  oc: "",
  contract_period: "",
  working_with: "",
  working_with_team_ids: "",
  working_with_user_ids: "",
  support_needed: false,
  support_type: "",
  support_note: "",
};

function EditOpportunityForm({ open, onClose, opportunity, onSaved }) {
  const { maps, master, activeStages, profile, createOpportunity, updateWithHistory } = useData();
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const canReview = ["sm", "admin"].includes(profile?.app_role);
  const closedAe = !!opportunity && opportunity.status !== "open" && profile?.app_role === "ae";

  useEffect(() => {
    if (opportunity) {
      setForm({ ...empty, ...opportunity,
        working_with_team_ids: opportunity.working_with_team_ids ||
          (master?.WorkingWithOption || []).find(t=>t.name===opportunity.working_with)?.id || "",
        working_with_user_ids: opportunity.working_with_user_ids || "",
      });
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

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v, ...(k === "region_id" ? { territory_id: "" } : {}) })); setSaveError(""); };
  const canChangeOwner = ["sm", "management", "admin"].includes(profile?.app_role);
  useEffect(() => { if (open) setSaveError(""); }, [open]);

  const regionOptions = useMemo(
    () => (master?.Region || []).filter((r) => r.active).sort((a, b) => a.order - b.order).map((r) => ({ value: r.id, label: r.name })),
    [master]
  );
  const territoryOptions = useMemo(
    () => (master?.Territory || []).filter((t) => t.active && t.region_id === form.region_id).map((t) => ({ value: t.id, label: t.name })),
    [master, form.region_id]
  );
  const ownerOptions = useMemo(
    () => (master?.TeamMember || [])
      .filter((m) => m.active && m.app_role === "ae" && (m.region_ids || []).includes(form.region_id))
      .map((m) => ({ value: m.id, label: m.name })),
    [master, form.region_id]
  );
  const handlerOptions = useMemo(
    () => (master?.TeamMember || [])
      .filter((m) => m.active && ["ae", "sm"].includes(m.app_role) && (m.region_ids || []).includes(form.region_id))
      .map((m) => ({ value: m.id, label: `${m.name} (${m.app_role.toUpperCase()})` })),
    [master, form.region_id]
  );
  const categoryOptions = useMemo(
    () => (master?.ProductCategory || []).filter((c) => c.active).sort((a, b) => a.order - b.order).map((c) => ({ value: c.id, label: c.name })),
    [master]
  );
  const scenarioOptions = useMemo(
    () => (master?.Scenario || []).filter((s) => s.active).sort((a, b) => a.order - b.order).map((s) => ({ value: s.id, label: s.name })),
    [master]
  );
  const workingWithOptions = useMemo(
    () => (master?.WorkingWithOption || []).filter((w) => w.active).map((w) => ({ value: w.name, label: w.name })),
    [master]
  );
  const supportTypeOptions = useMemo(
    () => (master?.SupportType || []).filter((s) => s.active).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((s) => ({ value: s.name, label: s.name })),
    [master]
  );

  const legacyEdit = Boolean(opportunity && (opportunity.price_per_sub === "" || opportunity.price_per_sub == null));
  const hasUnitPrice = form.price_per_sub !== "" && form.price_per_sub != null;
  let calculatedNetRc = null;
  if (hasUnitPrice) {
    try {
      calculatedNetRc = calculateNetRc({ quantity: form.quantity, pricePerSub: form.price_per_sub, oc: form.oc });
    } catch { /* Do not show a calculation until inputs are valid. */ }
  }
  const changed = (field) => String(form[field] ?? "") !== String(opportunity?.[field] ?? "");
  const requiredProblem = (field, good, label) =>
    !good && (!opportunity || changed(field)) ? label : "";
  const pricingChanged = ["quantity", "price_per_sub", "oc"].some(changed);
  const problems = [
    requiredProblem("customer_name", !!String(form.customer_name || "").trim(), "Customer Name"),
    requiredProblem("business_id", /^\d+$/.test(String(form.business_id || "").trim()), "Business ID"),
    requiredProblem("customer_type", !!form.customer_type, "Customer Type"),
    requiredProblem("sales_channel", !!form.sales_channel, "Sales Channel"),
    requiredProblem("contact_name", !!String(form.contact_name || "").trim(), "Contact Name"),
    requiredProblem("contact_phone", !!String(form.contact_phone || "").trim(), "Contact Phone"),
    requiredProblem("region_id", !!form.region_id, "Region"),
    requiredProblem("owner_id", !!form.owner_id, "Opportunity Owner"),
    requiredProblem("product_category_id", !!form.product_category_id, "Product Category"),
    requiredProblem("stage_id", !!form.stage_id, "Stage"),
    requiredProblem("expected_close_month", !!form.expected_close_month, "Expected Close Month"),
    String(form.remark || "").length > 500 && "Remark (max 500 characters)",
    form.support_needed && !String(form.support_type || "").trim() && "Support Type",
    form.support_needed && !String(form.support_note || "").trim() && "Support Note",
    (pricingChanged || !opportunity) && !(legacyEdit && !hasUnitPrice) && calculatedNetRc === null &&
      "Number of Subs / Price per Sub",
  ].filter(Boolean);
  const valid = problems.length === 0;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const payload = {
        customer_name: form.customer_name.trim(),
        business_id: String(form.business_id || "").trim(),
        customer_type: form.customer_type,
        sales_channel: form.sales_channel,
        partner_name: form.sales_channel === "B2B Premium Partner" ? String(form.partner_name || "").trim() : "",
        contact_name: String(form.contact_name || "").trim(),
        contact_phone: String(form.contact_phone || "").trim(),
        remark: String(form.remark || "").trim(),
        region_id: form.region_id,
        territory_id: form.territory_id || "",
        owner_id: form.owner_id,
        current_handler_id: form.current_handler_id || form.owner_id,
        product_category_id: form.product_category_id,
        product_details: String(form.product_details || "").trim(),
        stage_id: form.stage_id,
        expected_close_month: form.expected_close_month,
        scenario_id: form.scenario_id || "",
        ccp_check_result: form.ccp_check_result || "",
        quantity: form.quantity === "" || form.quantity == null ? null : Number(form.quantity),
        price_per_sub: hasUnitPrice ? Number(form.price_per_sub) : null,
        oc: form.oc === "" || form.oc == null ? null : Number(form.oc),
        contract_period: form.contract_period ? Number(form.contract_period) : null,
        working_with: form.working_with || "",
        working_with_team_ids: form.working_with_team_ids || "",
        working_with_user_ids: form.working_with_user_ids || "",
        support_needed: !!form.support_needed,
        support_type: form.support_needed ? (form.support_type || "") : "",
        support_note: form.support_needed ? String(form.support_note || "").trim() : "",
        pipeline_value: calculatedNetRc,
      };
      if (legacyEdit && !hasUnitPrice) {
        delete payload.pipeline_value;
        delete payload.quantity;
        delete payload.price_per_sub;
        delete payload.oc;
      }
      if (opportunity) {
        const changedPayload = Object.fromEntries(
          Object.entries(payload).filter(([key, value]) =>
            key !== "pipeline_value" && String(value ?? "") !== String(opportunity[key] ?? "")
          )
        );
        if (pricingChanged && calculatedNetRc !== null) changedPayload.pipeline_value = calculatedNetRc;
        if (Object.keys(changedPayload).length) await updateWithHistory(opportunity.id, changedPayload, null, {
          expectedUpdatedAt: opportunity.updated_date,
        });
      } else {
        await createOpportunity(payload);
      }
      onSaved?.();
      onClose();
    } catch (error) {
      setSaveError(error?.message || "Unable to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Pipeline</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
          <div className="sm:col-span-2">
            <Label>Customer Name *</Label>
            <Input maxLength={200} value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} placeholder="e.g. PTT Public Company Limited" />
          </div>

          <div>
            <Label>Business ID *</Label>
            <Input value={form.business_id} onChange={(e) => set("business_id", e.target.value)} placeholder="Tax ID / ref" />
          </div>
          <div>
            <Label>Customer Type *</Label>
            <Select value={form.customer_type} onValueChange={(v) => set("customer_type", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {CUSTOMER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Sales Channel *</Label>
            <Select value={form.sales_channel || ""} onValueChange={(v) => set("sales_channel", v)}>
              <SelectTrigger><SelectValue placeholder="Select channel" /></SelectTrigger>
              <SelectContent>{["AE B2B GEO", "AE Self", "B2B Premium Partner"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {form.sales_channel === "B2B Premium Partner" && (
            <div>
              <Label>Partner Name</Label>
              <Input maxLength={200} value={form.partner_name || ""} onChange={(e) => set("partner_name", e.target.value)} />
            </div>
          )}
          <div><Label>Contact Name *</Label><Input maxLength={120} value={form.contact_name || ""} onChange={(e) => set("contact_name", e.target.value)} /></div>
          <div><Label>Contact Phone *</Label><Input type="tel" maxLength={40} value={form.contact_phone || ""} onChange={(e) => set("contact_phone", e.target.value)} /></div>
          <div className="sm:col-span-2">
            <Label>Remark</Label>
            <Textarea maxLength={500} rows={2} value={form.remark || ""} onChange={(e) => set("remark", e.target.value)} />
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
            <Select value={form.owner_id} onValueChange={(v) => set("owner_id", v)} disabled={!canChangeOwner}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {ownerOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Current Handler</Label>
            <Select value={form.current_handler_id} onValueChange={(v) => set("current_handler_id", v)}>
              <SelectTrigger><SelectValue placeholder="Defaults to owner" /></SelectTrigger>
              <SelectContent>
                {handlerOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Product Category *</Label>
            <Select value={form.product_category_id} onValueChange={(v) => set("product_category_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {categoryOptions.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Product Description (Free Text)</Label>
            <Input maxLength={2000} value={form.product_details || ""} onChange={(e) => set("product_details", e.target.value)} placeholder="Enter product / package description" />
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
            <Label>Expected Close Month *</Label>
            {closedAe ? <Input readOnly aria-label="Expected Close Month locked for closed Pipeline" value={formatMonth(form.expected_close_month)} className="bg-muted/40" /> : <MonthPicker value={form.expected_close_month} onChange={(v) => set("expected_close_month", v)} />}
          </div>

          <div>
            <Label>{legacyEdit && !hasUnitPrice ? "Existing Pipeline Value (legacy)" : "Net RC (THB/Month)"}</Label>
            <Input readOnly value={calculatedNetRc !== null ? formatNetRc(calculatedNetRc) : legacyEdit ? formatNetRc(opportunity.pipeline_value) : "—"} className="bg-muted/40 font-semibold tabular-nums" />
          </div>
          <div>
            <Label>Scenario</Label>
            {canReview ? (
              <Select value={form.scenario_id || ""} onValueChange={(v) => set("scenario_id", v)}>
                <SelectTrigger><SelectValue placeholder="Pending SM Review" /></SelectTrigger>
                <SelectContent>{scenarioOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Input readOnly value={maps.scenario?.[form.scenario_id]?.name || "Pending SM Review"} className="bg-slate-50 text-slate-500" />
            )}
          </div>
          <div>
            <Label>CCP+ Check</Label>
            {canReview ? (
              <Select value={form.ccp_check_result || ""} onValueChange={(v) => set("ccp_check_result", v)}>
                <SelectTrigger><SelectValue placeholder="Pending SM Review" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_in_base">Not in Base (New Customer)</SelectItem>
                  <SelectItem value="enterprise_base">Enterprise Existing Base</SelectItem>
                  <SelectItem value="pending">Pending Review</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Input readOnly value={{ not_in_base: "Not in Base (New Customer)", enterprise_base: "Enterprise Existing Base", pending: "Pending Review" }[form.ccp_check_result] || "Pending SM Review"} className="bg-slate-50 text-slate-500" />
            )}
          </div>

          <div>
            <Label>Number of Subs *</Label>
            <Input type="number" min="1" step="1" disabled={closedAe} value={form.quantity ?? ""} onChange={(e) => set("quantity", e.target.value)} />
          </div>
          <div>
            <Label>Price per Sub (THB/Month) *</Label>
            <Input type="number" min="0" step="0.01" disabled={closedAe} value={form.price_per_sub ?? ""} onChange={(e) => set("price_per_sub", e.target.value)} />
          </div>
          <div>
            <Label>OC (THB)</Label>
            <Input type="number" min="0" step="0.01" disabled={closedAe} value={form.oc ?? ""} onChange={(e) => set("oc", e.target.value)} />
          </div>
          <div>
            <Label>Contract Period (months)</Label>
            <Input type="number" disabled={closedAe} value={form.contract_period ?? ""} onChange={(e) => set("contract_period", e.target.value)} />
          </div>

          <div>
            <Label>Working With</Label>
            <WorkingWithMultiSelect
              teams={master?.WorkingWithOption || []}
              people={master?.TeamMember || []}
              regionId={form.region_id}
              disabled={closedAe}
              teamIds={form.working_with_team_ids}
              userIds={form.working_with_user_ids}
              onTeams={v=>set("working_with_team_ids",v)}
              onUsers={v=>set("working_with_user_ids",v)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t">
          <Switch checked={form.support_needed} onCheckedChange={(v) => set("support_needed", v)} />
          <Label className="cursor-pointer">Needs Support</Label>
        </div>
        {form.support_needed && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Support Type</Label>
              <Select value={form.support_type} onValueChange={(v) => set("support_type", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {supportTypeOptions.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Support Note</Label>
              <Textarea maxLength={1000} value={form.support_note} onChange={(e) => set("support_note", e.target.value)} rows={2} />
            </div>
          </div>
        )}

        {!valid && <p role="alert" className="text-xs text-amber-700">Check: {problems.join(", ")}</p>}
        {saveError && <p role="alert" className="text-sm text-red-600">{saveError}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || saving}>
            {saving ? "Saving…" : opportunity ? "Save Changes" : "Create Opportunity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
// Keep historical-record editing unchanged while giving Create its dedicated modal.
export default function OpportunityForm(props) {
  return props.opportunity ? <EditOpportunityForm {...props} /> : <CreatePipelineModal {...props} />;
}
