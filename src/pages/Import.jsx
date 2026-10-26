import React, { useState, useMemo, useRef, useEffect } from "react";
import { useData } from "@/lib/dataContext";
import { db } from "@/api/client";
import { mapImportHeaders, needsExplicitCreatedMonthMapping } from "@/lib/importHeaderMapping";
import { readImportFile, parseImportCreatedMonth, parseImportSourceDate } from "@/lib/importWorkbook";
import { calculateNetRc } from "@/lib/netRc";
import { businessIdError, normalizeCustomerType, netRcReconciliation, CUSTOMER_TYPES } from "@/lib/pipelineValidation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, CheckCircle2, AlertTriangle, FileUp } from "lucide-react";

// Known importable fields and their target keys
const FIELDS = [
  { key: "created_month", label: "Create Month" },
  { key: "source_created_at", label: "Original Created Date" },
  { key: "source_stage_entered_at", label: "Original Stage Entered Date" },
  { key: "source_closed_at", label: "Original Closed Date" },
  { key: "source_system", label: "Source System" },
  { key: "source_record_id", label: "Source Opportunity ID" },
  { key: "customer_name", label: "Customer Name", required: true },
  { key: "business_id", label: "Business ID", required: true },
  { key: "customer_type", label: "Customer Type", required: true },
  { key: "sales_channel", label: "Sales Channel", required: true },
  { key: "partner_name", label: "Partner Name" },
  { key: "contact_name", label: "Contact Name" },
  { key: "contact_phone", label: "Contact Phone" },
  { key: "remark", label: "Remark" },
  { key: "region", label: "Region", required: true, resolve: "region" },
  { key: "territory", label: "Territory", resolve: "territory" },
  { key: "owner", label: "Opportunity Owner", required: true, resolve: "member" },
  { key: "handler", label: "Current Handler", resolve: "member" },
  { key: "product_category", label: "Product Category", required: true, resolve: "category" },
  { key: "product_details", label: "Product Details" },
  { key: "source_product_id", label: "Legacy Product ID" },
  { key: "source_rc", label: "Source RC" },
  { key: "source_discount_pct", label: "Source Discount %" },
  { key: "source_monthly_sale_plan", label: "Source Monthly Sale Plan" },
  { key: "quantity", label: "Number of Subs", required: true, type: "number" },
  { key: "price_per_sub", label: "Price per Sub", required: true, type: "number" },
  { key: "oc", label: "OC", type: "number" },
  { key: "reference_net_rc", label: "Reference Net RC" },
  { key: "contract_period", label: "Contract Period", type: "number" },
  { key: "expected_close_month", label: "Expected Close Month", required: true },
  { key: "scenario", label: "Scenario", resolve: "scenario" },
  { key: "ccp_check_result", label: "CCP+ Check" },
  { key: "stage", label: "Stage", resolve: "stage" },
  { key: "status", label: "Status" },
  { key: "lost_reason", label: "Lost Reason", resolve: "reason" },
  { key: "working_with", label: "Working With" },
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

export default function Import() {
  const { master, activeStages, refresh, profile } = useData();
  const [step, setStep] = useState("upload"); // upload | map | preview | done
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [rowNumbers, setRowNumbers] = useState([]);
  const [mapping, setMapping] = useState({}); // fieldKey -> headerIndex
  const [result, setResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importBatchId, setImportBatchId] = useState("");
  const fileRef = useRef();
  const [customerTypes, setCustomerTypes] = useState([...CUSTOMER_TYPES]);
  const [customerTypesError, setCustomerTypesError] = useState("");

  useEffect(() => {
    if (profile?.app_role !== "admin" && profile?.app_role !== "sm") return;
    let active = true;
    db.imports.customerTypes().then((reply) => {
      if (active) {
        setCustomerTypes(reply.values || []);
        setCustomerTypesError("");
      }
    }).catch(() => { if (active) setCustomerTypesError("Cannot verify active Customer Types"); });
    return () => { active = false; };
  }, [profile?.app_role]);

  // Accept stable ID or exact display name. Ambiguous matches fail closed.
  const byName = (entity) => {
    const names = {};
    for (const record of master?.[entity] || []) {
      for (const value of [record.name, record.id, entity === "TeamMember" && profile?.app_role === "admin" ? record.employee_id : ""]) {
        const key = String(value || "").trim().toLowerCase();
        if (!key) continue;
        if (key in names && names[key]?.id !== record.id) names[key] = null;
        else if (!(key in names)) names[key] = record;
      }
    }
    return names;
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError("");
    setImportBatchId(crypto.randomUUID().replace(/-/g, ""));
    let parsed;
    try {
      parsed = await readImportFile(file, parseCSV);
    } catch (error) {
      setImportError(error.message || "Unable to read file");
      return;
    }
    const hdrs = parsed.headers;
    setHeaders(hdrs);
    setRows(parsed.rows);
    setRowNumbers(parsed.rowNumbers || parsed.rows.map((_, i) => i + 2));
    // auto-map
    const auto = mapImportHeaders(hdrs, FIELDS);
    setMapping(auto);
    setStep("map");
  };

  const resolve = useMemo(() => ({
    region: byName("Region"),
    territory: byName("Territory"),
    member: byName("TeamMember"),
    category: byName("ProductCategory"),
    scenario: byName("Scenario"),
    stage: byName("Stage"),
    reason: byName("LostReason"),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [master]);

  const validated = useMemo(() => {
    if (step !== "preview" && step !== "map") return [];
    const unresolvedSourceMonth = needsExplicitCreatedMonthMapping(headers, mapping);
    const mappedColumns = Object.values(mapping).filter((idx) => idx != null);
    const duplicateColumn = new Set(mappedColumns).size !== mappedColumns.length;
    return rows.map((row, i) => {
      const errors = [];
      if (unresolvedSourceMonth) errors.push("Create Month column detected; select the correct source column in Map Columns");
      if (duplicateColumn) errors.push("A source column cannot be mapped to multiple fields");
      if (customerTypesError) errors.push(customerTypesError);
      const rec = { status: "open" };
      FIELDS.forEach((f) => {
        const idx = mapping[f.key];
        if (idx == null) return;
        let val = (row[idx] || "").trim();
        if (f.key === "created_month") {
          // Only explicitly mapped, valid source months reach the import-only API.
          // A mapped blank is an error; without a mapping, backend uses server month.
          if (!val) errors.push("Create Month is blank; supply the original month or skip mapping");
          else {
            const parsed = parseImportCreatedMonth(val);
            if (!parsed) errors.push(`Create Month "${val}" must be a valid YYYY-MM or unambiguous date (e.g. 1-Jul-26)`);
            else rec.source_created_month = parsed;
          }
          return;
        }
        if (!val) return;
        if (["source_created_at", "source_stage_entered_at", "source_closed_at"].includes(f.key)) {
          const date = parseImportSourceDate(val);
          if (!date) errors.push(`${f.label} must be an unambiguous real date (YYYY-MM-DD or 1-Jul-26)`);
          else rec[f.key] = date;
          return;
        }
        if (f.key === "status") {
          const status = val.toLowerCase();
          if (!["open", "won", "lost"].includes(status)) errors.push("Historical Status must be Open, Won or Lost");
          else rec.status = status;
          return;
        }
        if (f.resolve) {
          const ent = resolve[f.resolve][val.toLowerCase()];
          if (!ent) errors.push(`${f.label} "${val}" not found or ambiguous`);
          else rec[f.key + (f.resolve === "member" ? (f.key === "owner" ? "_id" : "_id") : "_id")] = ent.id;
          // map resolve keys to id fields
          if (f.resolve === "region") rec.region_id = ent.id;
          else if (f.resolve === "territory") rec.territory_id = ent.id;
          else if (f.resolve === "member") rec[f.key === "owner" ? "owner_id" : "current_handler_id"] = ent.id;
          else if (f.resolve === "category") rec.product_category_id = ent.id;
          else if (f.resolve === "scenario") rec.scenario_id = ent.id;
          else if (f.resolve === "stage") rec.stage_id = ent.id;
        } else if (f.key === "customer_type") {
          const canonical = normalizeCustomerType(val) || customerTypes.find((type) => type.toLowerCase() === val.toLowerCase());
          if (!canonical) errors.push(`Customer Type "${val}" is not an active or recognized legacy value`);
          else rec.customer_type = canonical;
        } else if (f.type === "number") {
          const parsed = Number(val);
          if (!Number.isFinite(parsed)) errors.push(`${f.label} must be a number`);
          else rec[f.key] = parsed;
        } else {
          rec[f.key] = val;
        }
      });
      FIELDS.filter((f) => f.required).forEach((f) => {
        const idx = mapping[f.key];
        const val = idx != null ? (row[idx] || "").trim() : "";
        if (!val) errors.push(`${f.label} is required`);
      });
      if (rec.source_created_at && rec.source_created_month &&
          rec.source_created_at.slice(0, 7) !== rec.source_created_month)
        errors.push("Original Created Date does not match Create Month");
      if (rec.source_created_at && rec.source_stage_entered_at && rec.source_stage_entered_at < rec.source_created_at)
        errors.push("Original Stage Entered Date precedes Created Date");
      if (["won", "lost"].includes(rec.status) && !rec.source_closed_at)
        errors.push("Historical Won/Lost requires Original Closed Date");
      if (rec.status === "lost" && !rec.lost_reason_id)
        errors.push("Historical Lost requires Lost Reason");
      if (rec.status === "open" && rec.source_closed_at)
        errors.push("Open Pipeline cannot have a Closed Date");
      if (rec.source_closed_at && rec.source_created_at && rec.source_closed_at < rec.source_created_at)
        errors.push("Closed Date precedes Created Date");
      if (rec.source_closed_at && rec.source_stage_entered_at && rec.source_closed_at < rec.source_stage_entered_at)
        errors.push("Closed Date precedes Stage Entered Date");
      if (!rec.current_handler_id && rec.owner_id) rec.current_handler_id = rec.owner_id;
      if (!rec.stage_id && activeStages[0]) rec.stage_id = activeStages[0].id;
      if (rec.support_needed) rec.support_needed = ["yes", "true", "1", "y"].includes(rec.support_needed.toLowerCase());
      if (rec.business_id && businessIdError(rec.business_id)) errors.push(businessIdError(rec.business_id));
      const referenceNetRc = rec.reference_net_rc;
      // Keep the reference value for independent backend reconciliation.
      let reconciliation = { checked: false, matches: null };
      if (referenceNetRc !== undefined) {
        let calculated = NaN;
        try { calculated = calculateNetRc({ quantity: rec.quantity, pricePerSub: rec.price_per_sub, oc: rec.oc }); } catch { /* validation below handles missing price */ }
        reconciliation = netRcReconciliation({ expected: referenceNetRc, calculated });
        if (reconciliation.error) errors.push(reconciliation.error);
      }
      if (rec.sales_channel && !["AE B2B GEO", "AE Self", "B2B Premium Partner"].includes(rec.sales_channel)) errors.push("Sales Channel is invalid");
      if (rec.remark && rec.remark.length > 500) errors.push("Remark exceeds 500 characters");
      if (rec.quantity != null && (!Number.isSafeInteger(Number(rec.quantity)) || Number(rec.quantity) <= 0)) errors.push("Number of Subs must be a positive whole number");
      if (rec.price_per_sub != null && (!Number.isFinite(Number(rec.price_per_sub)) || Number(rec.price_per_sub) < 0)) errors.push("Price per Sub is invalid");
      if (rec.oc != null && (!Number.isFinite(Number(rec.oc)) || Number(rec.oc) < 0)) errors.push("OC is invalid");
      return { row: rowNumbers[i] || i + 2, rec, errors, reconciliation };
    });
  }, [rows, rowNumbers, headers, mapping, resolve, step, activeStages, customerTypes, customerTypesError]);

  if (profile?.app_role !== "admin" && profile?.app_role !== "sm") {
    return (
      <div className="p-10 max-w-[600px] mx-auto text-center">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Import</h1>
        <p className="text-sm text-muted-foreground">Import is available to Admin and SM users only.</p>
      </div>
    );
  }

  const validRows = validated.filter((v) => v.errors.length === 0);
  const invalidRows = validated.filter((v) => v.errors.length > 0);

  const doImport = async () => {
    if (importing || !validRows.length || invalidRows.length || !importBatchId) return;
    setImporting(true);
    setImportError("");
    try {
      const response = await db.imports.opportunities(importBatchId, validRows.map((v) => v.rec));
      setResult({ ok: response.total, fail: 0, total: response.total,
        alreadyImported: response.already_imported });
      await refresh().catch(() => {}); // committed even when list refresh fails
      setStep("done");
    } catch (error) {
      setImportError(error.message || "Import failed. No new data should be saved.");
    } finally {
      setImporting(false);
    }
  };

  const reset = () => { setStep("upload"); setHeaders([]); setRows([]); setRowNumbers([]); setMapping({}); setResult(null); setImportBatchId(""); setImportError(""); if (fileRef.current) fileRef.current.value = ""; };

  return (
    <div className="p-5 md:p-7 max-w-[1000px] mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Import Opportunities</h1>
      <p className="text-sm text-muted-foreground mb-6">Upload .xlsx or .csv, map columns, validate, then confirm. Maximum 200 rows. Legacy finance is preserved for reconciliation, not used to change Net RC.</p>

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
        <div className="rounded-2xl border-2 border-dashed border-border bg-card p-12 text-center shadow-soft">
          <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
            <FileUp className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground mb-4">Select an Excel (.xlsx) or CSV file with your opportunity data</p>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" onChange={onFile} className="hidden" id="csv-upload" />
          <Button className="rounded-lg" onClick={() => document.getElementById("csv-upload").click()}><Upload className="w-4 h-4 mr-1.5" /> Choose File</Button>
          {importError && <p role="alert" className="mt-3 text-sm text-red-600">{importError}</p>}
        </div>
      )}

      {step === "map" && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
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
            <div className="rounded-2xl border border-border bg-card p-5 shadow-soft max-h-64 overflow-auto">
              <h3 className="font-semibold text-sm mb-3 text-rose-600">Invalid Rows</h3>
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

          {validated.length > 0 && !validated.some(v => v.reconciliation.checked) && <p role="status" className="mb-3 text-xs text-amber-700">No Reference Net RC mapped. Confirm the approved financial formula and reconcile totals with the source report before production import.</p>}
          {validated.some(v => v.reconciliation.checked && !v.reconciliation.matches) && <p role="alert" className="mb-3 text-xs text-red-600">Source Net RC differs from the calculated value. Resolve all mismatches before importing this file.</p>}
          {validRows.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-soft max-h-64 overflow-auto">
              <h3 className="font-semibold text-sm mb-3">Valid Rows Preview</h3>
              <table className="w-full text-xs">
                <thead><tr className="text-muted-foreground"><th className="text-left py-1">Customer</th><th className="text-left">Created Month</th><th className="text-left">Region</th><th className="text-left">Stage</th><th className="text-right">Net RC</th></tr></thead>
                <tbody>
                  {validRows.slice(0, 50).map((v) => (
                    <tr key={v.row} className="border-t border-border">
                      <td className="py-1">{v.rec.customer_name}</td>
                      <td>{v.rec.source_created_month || "Server import month"}</td>
                      <td>{master?.Region?.find((r) => r.id === v.rec.region_id)?.name}</td>
                      <td>{master?.Stage?.find((s) => s.id === v.rec.stage_id)?.name}</td>
                      <td className="text-right tabular-nums">{calculateNetRc({ quantity: v.rec.quantity, pricePerSub: v.rec.price_per_sub, oc: v.rec.oc })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {importError && <p role="alert" className="text-sm text-red-600">{importError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={importing} onClick={() => setStep("map")}>Back</Button>
            <Button onClick={doImport} disabled={validRows.length === 0 || invalidRows.length > 0 || importing}>{importing ? "Importing…" : "Confirm Import (" + validRows.length + ")"}</Button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="rounded-2xl border border-border bg-card p-10 text-center shadow-soft">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-9 h-9 text-emerald-600" />
          </div>
          <h2 className="text-lg font-semibold">Import Complete</h2>
          <p className="text-sm text-muted-foreground mt-1">{result?.alreadyImported ? "This batch was already imported (" + result.ok + " records). No duplicates created." : result?.ok + " imported successfully · " + result?.fail + " failed"}</p>
          <Button className="mt-5 rounded-lg" onClick={reset}>Import Another File</Button>
        </div>
      )}
    </div>
  );
}

function Step({ n, active, done, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${done ? "bg-emerald-600 text-white" : active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>{n}</span>
      <span className={active ? "font-medium" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}
function Sep() { return <span className="w-8 h-px bg-border" />; }
function Stat({ icon: Icon, color, label, value }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <Icon className={`w-5 h-5 ${color} mb-2`} />
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}