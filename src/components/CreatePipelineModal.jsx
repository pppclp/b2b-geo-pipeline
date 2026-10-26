import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { actionableErrorMessage } from "@/lib/actionFeedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { useData } from "@/lib/dataContext";
import { CUSTOMER_TYPES } from "@/lib/pipeline";
import { calculateNetRc, formatNetRc } from "@/lib/netRc";
import MonthPicker from "@/components/MonthPicker";

const EMPTY = {
  customer_name: "", business_id: "", customer_type: "", sales_channel: "AE B2B GEO",
  contact_name: "", contact_phone: "", remark: "", partner_name: "",
  product_category_id: "", product_details: "", quantity: "", price_per_sub: "",
  oc: "", contract_period: "", expected_close_month: "", owner_id: "",
  scenario_id: "", ccp_check_result: "",
};
const SALES_CHANNELS = ["AE B2B GEO", "AE Self", "B2B Premium Partner"];

function SectionHeading({ number, children, trailing }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 text-sm font-semibold">{number}</span>
      <h3 id={`section-${number}`} className="font-semibold text-[15px] text-foreground">{children}</h3>
      {trailing && <span className="ml-auto text-xs font-medium text-muted-foreground">{trailing}</span>}
    </div>
  );
}

function Field({ label, required, error, children, className = "" }) {
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      <Label className="block text-xs font-medium text-foreground">
        {label}{required && <span className="text-red-600"> *</span>}
      </Label>
      {children}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function CreatePipelineModal({ open, onClose, onSaved }) {
  const { master, activeStages, profile, createOpportunity } = useData();
  const [form, setForm] = useState(EMPTY);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [clientRequestId, setClientRequestId] = useState("");

  useEffect(() => {
    if (open) {
      setClientRequestId(crypto.randomUUID());
      setForm({ ...EMPTY, owner_id: profile?.app_role === "ae" ? profile.id : "" });
      setSubmitted(false);
      setExpanded(false);
      setSaving(false);
      setSaveError("");
    }
  }, [open, profile?.id, profile?.app_role]);

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaveError("");
  };
  const ownerIsAE = profile?.app_role === "ae";
  const smCanReview = ["sm","admin"].includes(profile?.app_role);
  const selectedOwner = ownerIsAE
    ? profile
    : (master?.TeamMember || []).find((m) => m.id === form.owner_id);
  const regionIds = selectedOwner?.region_ids || [];
  const allowedOwnerRegions = profile?.app_role === "admin" ? regionIds :
    regionIds.filter((id) => (profile?.region_ids || []).includes(id));
  const regionId = allowedOwnerRegions.includes(selectedOwner?.default_region_id)
    ? selectedOwner.default_region_id : allowedOwnerRegions[0] || "";
  const territoryIds = selectedOwner?.territory_ids || [];
  const territoryId = selectedOwner?.default_territory_id || (territoryIds.length === 1 ? territoryIds[0] : "");

  const categories = useMemo(
    () => (master?.ProductCategory || []).filter((c) => c.active).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [master]
  );
  const aeMembers = useMemo(
    () => (master?.TeamMember || []).filter((m) => m.active && m.app_role === "ae" &&
      (profile?.app_role === "admin" ||
        (m.region_ids || []).some((id) => (profile?.region_ids || []).includes(id))))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [master, profile]
  );

  const netRc = useMemo(() => {
    try {
      return calculateNetRc({ quantity: form.quantity, pricePerSub: form.price_per_sub, oc: form.oc });
    } catch { return null; }
  }, [form.quantity, form.price_per_sub, form.oc]);

  const errors = {};
  if (!form.customer_name.trim()) errors.customer_name = "Required";
  if (!/^\d+$/.test(form.business_id)) errors.business_id = "Enter digits only";
  if (!form.customer_type) errors.customer_type = "Required";
  if (!form.sales_channel) errors.sales_channel = "Required";
  if (!form.product_category_id) errors.product_category_id = "Required";
  if (form.quantity === "" || !Number.isSafeInteger(Number(form.quantity)) || Number(form.quantity) <= 0) errors.quantity = "Enter a positive whole number";
  if (form.price_per_sub === "" || !Number.isFinite(Number(form.price_per_sub)) || Number(form.price_per_sub) < 0) errors.price_per_sub = "Enter a valid price";
  if (form.oc !== "" && (!Number.isFinite(Number(form.oc)) || Number(form.oc) < 0)) errors.oc = "Enter a valid OC";
  if (!form.expected_close_month) errors.expected_close_month = "Required";
  if (!selectedOwner) errors.owner_id = "Select an AE";
  if (selectedOwner && !regionId) errors.owner_id = "Assigned AE needs a default Region in User Master";
  const hasErrors = Object.keys(errors).length > 0 || netRc === null;

  const dirty = Object.keys(EMPTY).some((key) =>
    key !== "owner_id" && form[key] !== EMPTY[key]
  );
  const requestClose = () => {
    if (saving) return;
    if (!dirty || window.confirm("Discard changes to this Pipeline?")) onClose();
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasErrors || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const payload = {
        client_request_id: clientRequestId,
        customer_name: form.customer_name.trim(),
        business_id: form.business_id,
        customer_type: form.customer_type,
        sales_channel: form.sales_channel,
        contact_name: form.contact_name.trim(),
        contact_phone: form.contact_phone.trim(),
        remark: form.remark.trim(),
        partner_name: form.sales_channel === "B2B Premium Partner" ? form.partner_name.trim() : "",
        product_category_id: form.product_category_id,
        product_details: form.product_details.trim(),
        quantity: Number(form.quantity),
        price_per_sub: Number(form.price_per_sub),
        oc: form.oc === "" ? null : Number(form.oc),
        contract_period: form.contract_period === "" ? null : Number(form.contract_period),
        expected_close_month: form.expected_close_month,
        pipeline_value: netRc,
        owner_id: selectedOwner.id,
        current_handler_id: selectedOwner.id,
        region_id: regionId,
        territory_id: territoryId || "",
        stage_id: activeStages[0]?.id || "",
        scenario_id: smCanReview ? form.scenario_id : "",
        ccp_check_result: smCanReview ? form.ccp_check_result : "",
      };
      if (!payload.stage_id) throw new Error("No active Stage is configured");
      await createOpportunity(payload);
      onSaved?.();
      onClose();
    } catch (error) {
      setSaveError(actionableErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <DialogContent
        className={`p-0 gap-0 w-[calc(100vw-2rem)] max-h-[92vh] flex flex-col overflow-hidden rounded-2xl sm:rounded-2xl
          ${expanded ? "sm:max-w-[1280px]" : "sm:max-w-[1000px]"}`}
        onEscapeKeyDown={(event) => { event.preventDefault(); requestClose(); }}
        onPointerDownOutside={(event) => { event.preventDefault(); requestClose(); }}
      >
        <DialogHeader className="flex-none border-b px-6 md:px-7 py-5 pr-24 text-left relative">
          <DialogTitle className="text-xl font-semibold tracking-tight">Create New Pipeline</DialogTitle>
          <DialogDescription className="sr-only">Enter customer and product information to create a Pipeline.</DialogDescription>
          <Button
            type="button" variant="ghost" size="icon" aria-label={expanded ? "Collapse" : "Expand"}
            title={expanded ? "Collapse" : "Expand"}
            onClick={() => setExpanded((value) => !value)}
            className="absolute right-12 top-3.5 h-9 w-9"
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </DialogHeader>

        <form id="new-pipeline-form" onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-6 md:px-7 py-5 space-y-5">
            <section aria-labelledby="section-1">
              <SectionHeading number="1">Customer Information</SectionHeading>
              {!ownerIsAE && (
                <div className="mb-4 max-w-sm">
                  <Field label="AE Owner" required error={submitted && errors.owner_id}>
                    <Select value={form.owner_id} onValueChange={(v) => set("owner_id", v)}>
                      <SelectTrigger aria-label="AE Owner"><SelectValue placeholder="Select AE" /></SelectTrigger>
                      <SelectContent>{aeMembers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-4">
                <Field label="Customer Name" required error={submitted && errors.customer_name}>
                  <Input maxLength={200} value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} placeholder="Enter customer name" aria-invalid={submitted && !!errors.customer_name} />
                </Field>
                <Field label="Business ID" required error={submitted && errors.business_id}>
                  <Input value={form.business_id} inputMode="numeric" onChange={(e) => set("business_id", e.target.value.replace(/\D/g, ""))} placeholder="Enter business ID" aria-invalid={submitted && !!errors.business_id}/>
                </Field>
                <Field label="Customer Type" required error={submitted && errors.customer_type}>
                  <Select value={form.customer_type} onValueChange={(v) => set("customer_type", v)}>
                    <SelectTrigger aria-label="Customer Type"><SelectValue placeholder="Select customer type" /></SelectTrigger>
                    <SelectContent>{CUSTOMER_TYPES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Sales Channel" required>
                  <Select value={form.sales_channel} onValueChange={(v) => set("sales_channel", v)}>
                    <SelectTrigger aria-label="Sales Channel"><SelectValue /></SelectTrigger>
                    <SelectContent>{SALES_CHANNELS.map((channel) => <SelectItem key={channel} value={channel}>{channel}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Contact Name">
                  <Input maxLength={120} value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} placeholder="Enter contact name"/>
                </Field>
                <Field label="Contact Phone">
                  <Input type="tel" maxLength={40} value={form.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} placeholder="e.g. 08x-xxx-xxxx"/>
                </Field>
                <Field label="Remark" className="sm:col-span-2">
                  <Textarea rows={2} maxLength={500} value={form.remark} onChange={(e) => set("remark", e.target.value)} placeholder="Customer needs, next steps, details" className="resize-none" />
                  <div className="text-right text-[11px] text-muted-foreground">{form.remark.length}/500</div>
                </Field>
                {form.sales_channel === "B2B Premium Partner" && (
                  <Field label="Partner Name" className="sm:col-span-2">
                    <Input maxLength={200} value={form.partner_name} onChange={(e) => set("partner_name", e.target.value)} placeholder="Enter partner name"/>
                  </Field>
                )}
              </div>
            </section>

            <section aria-labelledby="section-2" className="border-t pt-5">
              <SectionHeading number="2">Product &amp; Value</SectionHeading>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <Field label="Product Category" required error={submitted && errors.product_category_id}>
                  <Select value={form.product_category_id} onValueChange={(v) => set("product_category_id", v)}>
                    <SelectTrigger aria-label="Product Category"><SelectValue placeholder="Select product category" /></SelectTrigger>
                    <SelectContent>{categories.map((cat) => <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Product Description (Free Text)">
                  <Input maxLength={2000} value={form.product_details} onChange={(e) => set("product_details", e.target.value)} placeholder="Enter package / solution / equipment description" />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <Field label="Number of Subs" required error={submitted && errors.quantity}>
                  <Input type="number" min="1" step="1" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="0" aria-invalid={submitted && !!errors.quantity}/>
                </Field>
                <Field label="Price per Sub (THB)" required error={submitted && errors.price_per_sub}>
                  <Input type="number" min="0" step="0.01" value={form.price_per_sub} onChange={(e) => set("price_per_sub", e.target.value)} placeholder="0.00" aria-invalid={submitted && !!errors.price_per_sub}/>
                </Field>
                <Field label="OC (THB)" error={submitted && errors.oc}>
                  <Input type="number" min="0" step="0.01" value={form.oc} onChange={(e) => set("oc", e.target.value)} placeholder="0.00" aria-invalid={submitted && !!errors.oc}/>
                </Field>
                <Field label="Contract Period">
                  <Input type="number" min="1" step="1" value={form.contract_period} onChange={(e) => set("contract_period", e.target.value)} placeholder="Months" />
                </Field>
                <Field label="Expected Close Month" required error={submitted && errors.expected_close_month}>
                  <MonthPicker value={form.expected_close_month} onChange={(v) => set("expected_close_month", v)} placeholder="MM / YYYY" />
                </Field>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
                <span className="text-sm font-medium text-slate-600">Net RC <span className="font-normal text-xs">(THB/month)</span></span>
                <output aria-live="polite" className="text-lg font-semibold tabular-nums text-foreground">
                  {netRc === null ? "—" : formatNetRc(netRc)}
                </output>
              </div>
            </section>

            <section aria-labelledby="section-3" className="border-t pt-5">
              <SectionHeading number="3" trailing={smCanReview ? "SM Input · Optional at Create" : "Completed by SM"}>Additional Information</SectionHeading>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Scenario">
                  {smCanReview ? (
                    <Select value={form.scenario_id || ""} onValueChange={(v) => set("scenario_id", v)}>
                      <SelectTrigger aria-label="Scenario"><SelectValue placeholder="Not set" /></SelectTrigger>
                      <SelectContent>{(master?.Scenario || []).filter((item) => item.active).map((item) =>
                        <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : <Input value="To be completed by SM" readOnly aria-readonly="true"
                      className="bg-slate-50/70 text-slate-500 border-slate-200 cursor-default"/>}
                </Field>
                <Field label="CCP+ Check">
                  {smCanReview ? (
                    <Select value={form.ccp_check_result || ""} onValueChange={(v) => set("ccp_check_result", v)}>
                      <SelectTrigger aria-label="CCP+ Check"><SelectValue placeholder="Not set" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="not_in_base">Not in Base (New Customer)</SelectItem>
                        <SelectItem value="enterprise_base">Enterprise Existing Base</SelectItem>
                        <SelectItem value="pending">Pending Review</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : <Input value="To be completed by SM" readOnly aria-readonly="true"
                      className="bg-slate-50/70 text-slate-500 border-slate-200 cursor-default"/>}
                </Field>
              </div>
            </section>
          </div>

          <footer className="flex-none border-t bg-white px-6 md:px-7 py-4">
            {saveError && <p role="alert" className="text-sm text-red-600 mb-3">{saveError}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant="outline" className="gap-2" disabled={saving} onClick={() => { setForm({ ...EMPTY, owner_id: ownerIsAE ? profile?.id : "" }); setSubmitted(false); setSaveError(""); }}>
                <RotateCcw className="h-4 w-4"/> Clear All
              </Button>
              <div className="flex items-center gap-2 ml-auto">
                <Button type="button" variant="outline" disabled={saving} onClick={requestClose}>Cancel</Button>
                <Button type="submit" disabled={saving} className="bg-red-600 text-white hover:bg-red-700 min-w-[142px]">
                  {saving ? "Creating..." : "Create Pipeline"}
                </Button>
              </div>
            </div>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
