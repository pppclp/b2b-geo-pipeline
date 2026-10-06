import React, { useState, useMemo, useRef } from "react";
import { useData } from "@/lib/dataContext";
import { currentMonthKey, STATUS_LABELS } from "@/lib/pipeline";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, CheckCircle2, AlertTriangle, FileUp } from "lucide-react";

// Known importable fields and their target keys
const FIELDS = [
  { key: "customer_name", label: "Customer Name", required: true },
  { key: "business_id", label: "Business ID" },
  { key: "customer_type", label: "Customer Type" },
  { key: "region", label: "Region", required: true, resolve: "region" },
  { key: "territory", label: "Territory", resolve: "territory" },
  { key: "owner", label: "Opportunity Owner", required: true, resolve: "member" },
  { key: "handler", label: "Current Handler", resolve: "member" },
  { key: "product_category", label: "Product Category", required: true, resolve: "category" },
  { key: "product", label: "Product", resolve: "product" },
  { key: "stage", label: "Stage", required: true, resolve: "stage" },
  { key: "status", label: "Status" },
  { key: "expected_close_month", label: "Expected Close Month" },
  { key: "pipeline_value", label: "Pipeline Value", required: true, type: "number" },
  { key: "scenario", label: "Scenario", resolve: "scenario" },
  { key: "working_with", label: "Working With" },
  { key: "quantity", label: "Quantity", type: "number" },
  { key: "rc", label: "RC", type: "number" },
  { key: "oc", label: "OC", type: "number" },
  { key: "discount", label: "Discount", type: "number" },
  { key: "contract_period", label: "Contract Period", type: "number" },
  { key: "support_needed", label: "Support Needed" },
  { key: "support_type", label: "Support Type" },
  { key: "support_note", label: "Support Note" },
];

function parseCSV(text) {
  const rows = [];
  let cur = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function fuzzyMatch(header, key, label) {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  const candidates = [key, label].map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return candidates.includes(h) || candidates.some((c) => h.includes(c) || c.includes(h));
}

export default function Import() {
  const { master, activeStages, createOpportunity, profile } = useData();
  const [step, setStep] = useState("upload"); // upload | map | preview | done
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({}); // fieldKey -> headerIndex
  const [result, setResult] = useState(null);
  const fileRef = useRef();

  const byName = (entity) => Object.fromEntries((master?.[entity] || []).map((x) => [x.name.toLowerCase(), x]));

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCSV(text);
    if (!parsed.length) return;
    const hdrs = parsed[0].map((h) => h.trim());
    setHeaders(hdrs);
    setRows(parsed.slice(1));
    // auto-map
    const auto = {};
    FIELDS.forEach((f) => {
      const idx = hdrs.findIndex((h) => fuzzyMatch(h, f.key, f.label));
      if (idx >= 0) auto[f.key] = idx;
    });
    setMapping(auto);
    setStep("map");
  };

  const resolve = useMemo(() => ({
    region: byName("Region"),
    territory: byName("Territory"),
    member: byName("TeamMember"),
    category: byName("ProductCategory"),
    product: byName("Product"),
    scenario: byName("Scenario"),
    stage: byName("Stage"),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [master]);

  const validated = useMemo(() => {
    if (step !== "preview" && step !== "map") return [];
    return rows.map((row, i) => {
      const errors = [];
      const rec = { status: "open", created_month: currentMonthKey() };
      FIELDS.forEach((f) => {
        const idx = mapping[f.key];
        if (idx == null) return;
        let val = (row[idx] || "").trim();
        if (!val) return;
        if (f.resolve) {
          const ent = resolve[f.resolve][val.toLowerCase()];
          if (!ent) errors.push(`${f.label} "${val}" not found`);
          else rec[f.key + (f.resolve === "member" ? (f.key === "owner" ? "_id" : "_id") : "_id")] = ent.id;
          // map resolve keys to id fields
          if (f.resolve === "region") rec.region_id = ent.id;
          else if (f.resolve === "territory") rec.territory_id = ent.id;
          else if (f.resolve === "member") rec[f.key === "owner" ? "owner_id" : "current_handler_id"] = ent.id;
          else if (f.resolve === "category") rec.product_category_id = ent.id;
          else if (f.resolve === "product") rec.product_id = ent.id;
          else if (f.resolve === "scenario") rec.scenario_id = ent.id;
          else if (f.resolve === "stage") rec.stage_id = ent.id;
        } else if (f.type === "number") {
          rec[f.key] = Number(val) || 0;
        } else {
          rec[f.key] = val;
        }
      });
      FIELDS.filter((f) => f.required).forEach((f) => {
        const idx = mapping[f.key];
        const val = idx != null ? (row[idx] || "").trim() : "";
        if (!val) errors.push(`${f.label} is required`);
      });
      if (!rec.current_handler_id && rec.owner_id) rec.current_handler_id = rec.owner_id;
      if (!rec.stage_id && activeStages[0]) rec.stage_id = activeStages[0].id;
      if (rec.support_needed) rec.support_needed = ["yes", "true", "1", "y"].includes(rec.support_needed.toLowerCase());
      return { row: i + 2, rec, errors };
    });
  }, [rows, mapping, resolve, step, activeStages]);

  if (profile?.app_role !== "admin" && profile?.app_role !== "sm") {
    return (
      <div className="p-6 max-w-[600px] mx-auto text-center">
        <h1 className="text-xl font-semibold mb-1">Import</h1>
        <p className="text-sm text-muted-foreground">Import is available to Admin and SM users only.</p>
      </div>
    );
  }

  const validRows = validated.filter((v) => v.errors.length === 0);
  const invalidRows = validated.filter((v) => v.errors.length > 0);

  const doImport = async () => {
    let ok = 0, fail = 0;
    for (const v of validRows) {
      try { await createOpportunity(v.rec); ok++; } catch (e) { fail++; console.error(e); }
    }
    setResult({ ok, fail, total: validRows.length });
    setStep("done");
  };

  const reset = () => { setStep("upload"); setHeaders([]); setRows([]); setMapping({}); setResult(null); if (fileRef.current) fileRef.current.value = ""; };

  return (
    <div className="p-4 md:p-6 max-w-[1000px] mx-auto">
      <h1 className="text-xl font-semibold mb-1">Import Opportunities</h1>
      <p className="text-sm text-muted-foreground mb-4">Upload a CSV, map columns, validate, then confirm. (Excel: save as CSV first.)</p>

      <div className="flex items-center gap-2 mb-6 text-sm">
        <Step n={1} active={step === "upload"} done={["map", "preview", "done"].includes(step)} label="Upload" />
        <Sep />
        <Step n={2} active={step === "map"} done={["preview", "done"].includes(step)} label="Map Columns" />
        <Sep />
        <Step n={3} active={step === "preview"} done={step === "done"} label="Validate & Preview" />
        <Sep />
        <Step n={4} active={step === "done"} done={false} label="Import" />
      </div>

      {step === "upload" && (
        <div className="rounded-lg border-2 border-dashed border-border p-10 text-center">
          <FileUp className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-3">Select a CSV file with your opportunity data</p>
          <input ref={fileRef} type="file" accept=".csv" onChange={onFile} className="hidden" id="csv-upload" />
          <Button onClick={() => document.getElementById("csv-upload").click()}><Upload className="w-4 h-4 mr-1" /> Choose File</Button>
        </div>
      )}

      {step === "map" && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Map Columns</h2>
            <span className="text-sm text-muted-foreground">{rows.length} rows detected</span>
          </div>
          <div className="space-y-2">
            {FIELDS.map((f) => (
              <div key={f.key} className="grid grid-cols-2 gap-3 items-center">
                <span className="text-sm">{f.label}{f.required && <span className="text-rose-500"> *</span>}</span>
                <Select value={mapping[f.key] != null ? String(mapping[f.key]) : "none"} onValueChange={(v) => setMapping({ ...mapping, [f.key]: v === "none" ? undefined : Number(v) })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="— Skip —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Skip —</SelectItem>
                    {headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button onClick={() => setStep("preview")}>Validate</Button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat icon={CheckCircle2} color="text-emerald-600" label="Valid" value={validRows.length} />
            <Stat icon={AlertTriangle} color="text-rose-600" label="Invalid" value={invalidRows.length} />
            <Stat icon={Upload} color="text-muted-foreground" label="Total Rows" value={validated.length} />
          </div>

          {invalidRows.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4 max-h-64 overflow-auto">
              <h3 className="font-medium text-sm mb-2 text-rose-600">Invalid Rows</h3>
              <table className="w-full text-xs">
                <thead><tr className="text-muted-foreground"><th className="text-left py-1">Row</th><th className="text-left">Errors</th></tr></thead>
                <tbody>
                  {invalidRows.map((v) => (
                    <tr key={v.row} className="border-t border-border"><td className="py-1 pr-2 tabular-nums">{v.row}</td><td className="text-rose-600">{v.errors.join("; ")}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {validRows.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4 max-h-64 overflow-auto">
              <h3 className="font-medium text-sm mb-2">Valid Rows Preview</h3>
              <table className="w-full text-xs">
                <thead><tr className="text-muted-foreground"><th className="text-left py-1">Customer</th><th className="text-left">Region</th><th className="text-left">Stage</th><th className="text-right">Value</th></tr></thead>
                <tbody>
                  {validRows.slice(0, 50).map((v) => (
                    <tr key={v.row} className="border-t border-border">
                      <td className="py-1">{v.rec.customer_name}</td>
                      <td>{master?.Region?.find((r) => r.id === v.rec.region_id)?.name}</td>
                      <td>{master?.Stage?.find((s) => s.id === v.rec.stage_id)?.name}</td>
                      <td className="text-right tabular-nums">{v.rec.pipeline_value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setStep("map")}>Back</Button>
            <Button onClick={doImport} disabled={validRows.length === 0}>Confirm Import ({validRows.length})</Button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
          <h2 className="text-lg font-medium">Import Complete</h2>
          <p className="text-sm text-muted-foreground mt-1">{result?.ok} imported successfully · {result?.fail} failed</p>
          <Button className="mt-4" onClick={reset}>Import Another File</Button>
        </div>
      )}
    </div>
  );
}

function Step({ n, active, done, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${done ? "bg-emerald-600 text-white" : active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>{n}</span>
      <span className={active ? "font-medium" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}
function Sep() { return <span className="w-8 h-px bg-border" />; }
function Stat({ icon: Icon, color, label, value }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <Icon className={`w-5 h-5 ${color} mb-1`} />
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}