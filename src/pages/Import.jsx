import React, { useState, useMemo, useRef, useEffect } from "react";
import { useData } from "@/lib/dataContext";
import { db } from "@/api/client";
import { mapImportHeaders, needsExplicitCreatedMonthMapping } from "@/lib/importHeaderMapping";
import { normalizeHistoricalGeoSource } from "@/lib/historicalGeoSource";
import { makeHistoricalImportBatches } from "@/lib/importBatches";
import { readImportFile, parseImportCreatedMonth, parseImportSourceDate } from "@/lib/importWorkbook";
import { calculateNetRc } from "@/lib/netRc";
import { legacyNumber, legacyContractMonths, legacyStageName, legacyCustomerType, legacyProductCategory, legacySourceMonth, legacyBusinessId, legacySourceDocumentId, legacyRowSourceId } from "@/lib/legacyImport";
import { normalizeCustomerType, netRcReconciliation, CUSTOMER_TYPES } from "@/lib/pipelineValidation";
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
  { key: "source_sales_code", label: "Sales Code" },
  { key: "source_sale_name", label: "Sale Name" },
  { key: "customer_name", label: "Customer Name", required: true },
  { key: "business_id", label: "Business ID" },
  { key: "customer_type", label: "Customer Type", required: true },
  { key: "sales_channel", label: "Sales Channel", required: true },
  { key: "partner_name", label: "Partner Name" },
  { key: "contact_name", label: "Contact Name" },
  { key: "contact_phone", label: "Contact Phone" },
  { key: "remark", label: "Remark" },
  { key: "customer_location_text", label: "Customer Location / Province" },
  { key: "region", label: "Region", required: true, resolve: "region" },
  { key: "territory", label: "Territory", resolve: "territory" },
  { key: "owner", label: "Opportunity Owner", resolve: "member" },
  { key: "handler", label: "Current Handler", resolve: "member" },
  { key: "product_category", label: "Product Category", required: true, resolve: "category" },
  { key: "product_details", label: "Product Details" },
  { key: "source_product_id", label: "Legacy Product ID" },
  { key: "source_rc", label: "Source RC" },
  { key: "source_discount_pct", label: "Source Discount %" },
  { key: "source_monthly_sale_plan", label: "Source Monthly Sale Plan" },
  { key: "quantity", label: "Number of Subs", required: true, type: "number" },
  { key: "price_per_sub", label: "Price per Sub", type: "number" },
  { key: "oc", label: "OC", type: "number" },
  { key: "reference_net_rc", label: "Reference Net RC" },
  { key: "contract_period", label: "Contract Period", type: "number" },
  { key: "expected_close_month", label: "Expected Close Month" },
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
  const { master, refresh, profile } = useData();
  const [step, setStep] = useState("upload"); // upload | map | preview | done
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [rowNumbers, setRowNumbers] = useState([]);
  const [layoutErrors, setLayoutErrors] = useState([]);
  const [importProgress, setImportProgress] = useState({ completed: 0, total: 0, imported: 0, existing: 0 });
  const [mapping, setMapping] = useState({}); // fieldKey -> headerIndex
  const [result, setResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [importError, setImportError] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [rcInterpretation, setRcInterpretation] = useState("unknown");
  const [salesCodeLookup, setSalesCodeLookup] = useState({ byCode: {}, loading: false, error: "" });

  useEffect(() => {
    if (!["admin", "sm"].includes(profile?.app_role) || mapping.source_sales_code == null || !rows.length) {
      setSalesCodeLookup({ byCode: {}, loading: false, error: "" });
      return;
    }
    const codes = [...new Set(rows.map(row => String(row[mapping.source_sales_code] || "").trim()).filter(Boolean))];
    if (!codes.length) {
      setSalesCodeLookup({ byCode: {}, loading: false, error: "" });
      return;
    }
    let disposed = false;
    setSalesCodeLookup({ byCode: {}, loading: true, error: "" });
    db.imports.resolveOwners(codes).then(result => {
      if (disposed) return;
      const byCode = Object.fromEntries((result.owners || []).map(entry => [entry.code, entry]));
      setSalesCodeLookup({ byCode, loading: false, error: "" });
    }).catch(() => {
      if (!disposed) setSalesCodeLookup({ byCode: {}, loading: false,
        error: "Cannot validate Sales Codes against Users Master" });
    });
    return () => { disposed = true; };
  }, [rows, mapping.source_sales_code, profile?.app_role]);
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
    if (!file || readingFile) return;
    setReadingFile(true);
    setImportError("");
    try {
      const parsed = await readImportFile(file, parseCSV);
      // Hash the exact original rows before normalizing the mixed source layout.
      const fingerprint = await legacySourceDocumentId(parsed.headers, parsed.rows);
      const normalized = normalizeHistoricalGeoSource(parsed.headers, parsed.rows);
      const hdrs = normalized.headers;
      setDocumentId(fingerprint);
      setRcInterpretation("unknown");
      setHeaders(hdrs);
      setRows(normalized.rows);
      setLayoutErrors(normalized.layoutErrors);
      setImportProgress({ completed: 0, total: 0, imported: 0, existing: 0 });
      setRowNumbers(parsed.rowNumbers || parsed.rows.map((_, i) => i + 2));
      setMapping(mapImportHeaders(hdrs, FIELDS));
      setStep("map");
    } catch (error) {
      // No import is triggered by choosing a file. Keep the user on the upload screen.
      setImportError(error?.message || "Unable to read file. No records imported.");
    } finally {
      setReadingFile(false);
      if (fileRef.current) fileRef.current.value = "";
    }
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
      if (layoutErrors[i]) errors.push(layoutErrors[i]);
      if (unresolvedSourceMonth) errors.push("Create Month column detected; select the correct source column in Map Columns");
      if (duplicateColumn) errors.push("A source column cannot be mapped to multiple fields");
      if (customerTypesError) errors.push(customerTypesError);
      if (salesCodeLookup.error) errors.push(salesCodeLookup.error);
      if (salesCodeLookup.loading) errors.push("Validating Sales Codes");
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
            if (mapping.source_created_at == null) {
              const fullDate = parseImportSourceDate(val);
              if (fullDate) rec.source_created_at = fullDate;
            }
          }
          return;
        }
        if (!val) return;
        if (f.key === "business_id") {
          const id = legacyBusinessId(val);
          if (id === null) errors.push("Legacy Business ID must have 1-40 digits, without guessing zeroes");
          else rec.business_id = id;
          return;
        }
        if (f.key === "source_monthly_sale_plan") {
          const month = legacySourceMonth(val);
          if (!month) errors.push("Monthly Sale Plan must be YYYY-MM or Oct-26 (not Expected Close)");
          else rec.source_monthly_sale_plan = month;
          return;
        }
        if (f.key === "source_rc" || f.key === "reference_net_rc") {
          const amount = legacyNumber(val);
          if (amount === null || amount < 0) errors.push(f.label + " must be a non-negative amount");
          else rec[f.key] = String(amount);
          return;
        }
        if (f.key === "contract_period") {
          const months = legacyContractMonths(val);
          if (months === null) errors.push("Contract Period must be 1-120 months, e.g. 12 month");
          else rec.contract_period = months;
          return;
        }
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
          const key = f.resolve === "stage" ? legacyStageName(val) : f.resolve === "category" ? legacyProductCategory(val) : val;
          const ent = resolve[f.resolve]?.[key.toLowerCase()];
          if (!ent) {
            errors.push(`${f.label} "${val}" not found or ambiguous`);
            return;
          }
          if (f.resolve === "region") rec.region_id = ent.id;
          else if (f.resolve === "territory") rec.territory_id = ent.id;
          else if (f.resolve === "member") rec[f.key === "owner" ? "owner_id" : "current_handler_id"] = ent.id;
          else if (f.resolve === "category") rec.product_category_id = ent.id;
          else if (f.resolve === "scenario") rec.scenario_id = ent.id;
          else if (f.resolve === "stage") rec.stage_id = ent.id;
          else if (f.resolve === "reason") rec.lost_reason_id = ent.id;
        } else if (f.key === "customer_type") {
          rec.source_customer_type = val;
          const normalized = legacyCustomerType(val);
          const canonical = normalizeCustomerType(normalized) || customerTypes.find((type) => type.toLowerCase() === normalized.toLowerCase());
          if (!canonical) errors.push(`Customer Type "${val}" is not an active or recognized legacy value`);
          else rec.customer_type = canonical;
        } else if (f.type === "number") {
          const parsed = legacyNumber(val);
          if (parsed === null) errors.push(`${f.label} must be a valid number`);
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
      const salesCode = String(rec.source_sales_code || "").trim();
      if (salesCode) {
        const owner = salesCodeLookup.byCode[salesCode];
        if (!owner?.found) errors.push('Sales Code "' + salesCode + '" is unknown or outside your scope');
        else {
          if (rec.owner_id && rec.owner_id !== owner.id)
            errors.push("Sales Code conflicts with manually mapped Owner");
          // Name spellings in old files may differ; verified Sales Code governs owner identity.
          if (rec.region_id && !owner.region_ids?.includes(rec.region_id))
            errors.push("Sales Code AE is not assigned to the source Region");
          rec.owner_id = owner.id;
        }
      }
      if (!rec.owner_id) errors.push("Sales Code or Opportunity Owner is required");
      if (!rec.source_system) rec.source_system = "Legacy Spreadsheet";
      if (!rec.source_record_id && documentId) rec.source_record_id = legacyRowSourceId(documentId, rowNumbers[i] || i + 2);
      if (!rec.source_record_id) errors.push("Source row identity missing");
      if (mapping.oc != null && rec.oc == null) rec.oc = 0;
      if (rec.price_per_sub == null && rec.source_rc !== undefined && rec.quantity > 0) {
        const rc = Number(rec.source_rc);
        if (rec.quantity === 1 || rcInterpretation === "per_sub") rec.price_per_sub = rc;
        else if (rcInterpretation === "total") rec.price_per_sub = Math.round((rc / rec.quantity) * 100) / 100;
        else errors.push("Sub > 1: choose RC interpretation before deriving unit price");
      }
      if (rec.price_per_sub == null) errors.push("Price per Sub missing: map unit price or verify RC meaning");
      if (!rec.stage_id) errors.push("Current Stage is required");
      if (!rec.current_handler_id && rec.owner_id) rec.current_handler_id = rec.owner_id;
      if (rec.support_needed) rec.support_needed = ["yes", "true", "1", "y"].includes(rec.support_needed.toLowerCase());
      if (rec.business_id && legacyBusinessId(rec.business_id) === null) errors.push("Invalid Legacy Business ID");
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
  }, [rows, rowNumbers, headers, mapping, resolve, step, customerTypes, customerTypesError, documentId, rcInterpretation, salesCodeLookup, layoutErrors]);

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
    if (importing || !validRows.length || invalidRows.length || !documentId) return;
    setImporting(true);
    setImportError("");
    let completed = 0, imported = 0, existing = 0;
    try {
      const batches = makeHistoricalImportBatches(validRows.map((v) => v.rec), documentId);
      setImportProgress({ completed: 0, total: batches.length, imported: 0, existing: 0 });
      for (const batch of batches) {
        // The backend still validates and commits no more than 200 rows per request.
        // Stable batch IDs mean re-running after a partial success cannot duplicate it.
        const response = await db.imports.opportunities(batch.batchId, batch.items);
        if (response.already_imported) existing += Number(response.total || 0);
        else imported += Number(response.imported ?? response.total ?? 0);
        completed++;
        setImportProgress({ completed, total: batches.length, imported, existing });
      }
      setResult({ ok: imported, fail: 0, total: imported + existing, alreadyImported: existing });
      await refresh().catch(() => {});
      setStep("done");
    } catch (error) {
      await refresh().catch(() => {});
      setImportError(completed
        ? "Batch " + (completed + 1) + " failed after " + completed +
          " completed batches. Earlier batches remain committed. Fix the error and retry this SAME file; stable source identity prevents duplicate batches. " +
          (error.message || "Request failed")
        : (error.message || "Import failed. No batch was confirmed; retry with the same file."));
    } finally {
      setImporting(false);
    }
  };

  const reset = () => { setStep("upload"); setHeaders([]); setRows([]); setRowNumbers([]); setLayoutErrors([]); setImportProgress({ completed: 0, total: 0, imported: 0, existing: 0 }); setMapping({}); setResult(null); setDocumentId(""); setRcInterpretation("unknown"); setImportError(""); if (fileRef.current) fileRef.current.value = ""; };

  return (
    <div className="p-5 md:p-7 max-w-[1000px] mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Import Opportunities</h1>
      <p className="text-sm text-muted-foreground mb-6">Upload .xlsx or .csv, map columns, validate, then confirm. Up to 400 preview rows, committed in batches of at most 200. Legacy finance is preserved for reconciliation, not used to change Net RC.</p>

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
          <Button className="rounded-lg" disabled={readingFile} onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4 mr-1.5" /> {readingFile ? "Reading file…" : "Choose File"}</Button>
          {readingFile && <p role="status" className="mt-3 text-sm text-muted-foreground">Checking file format and source row identity…</p>}
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
          {mapping.source_rc != null && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mt-4 space-y-2">
            <p className="text-sm font-medium text-amber-900">Source RC interpretation (Sub &gt; 1)</p>
            <p className="text-xs text-amber-800">For a single Sub, either meaning gives the same unit price. Confirm the source definition for multiple Subs; Net RC is reconciled before writing.</p>
            <Select value={rcInterpretation} onValueChange={setRcInterpretation}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">Not verified — block multi-Sub</SelectItem>
                <SelectItem value="per_sub">RC is price per Sub</SelectItem>
                <SelectItem value="total">RC is total monthly amount</SelectItem>
              </SelectContent>
            </Select>
          </div>}
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
                <thead><tr className="text-muted-foreground"><th className="text-left py-1">Customer</th><th className="text-left">Created Month</th><th className="text-left">Region</th><th className="text-left">AE Owner</th><th className="text-left">Stage</th><th className="text-right">Net RC</th></tr></thead>
                <tbody>
                  {validRows.slice(0, 50).map((v) => (
                    <tr key={v.row} className="border-t border-border">
                      <td className="py-1">{v.rec.customer_name}</td>
                      <td>{v.rec.source_created_month || "Server import month"}</td>
                      <td>{master?.Region?.find((r) => r.id === v.rec.region_id)?.name}</td>
                      <td>{master?.TeamMember?.find((m) => m.id === v.rec.owner_id)?.name || v.rec.owner_id || "—"}</td>
                      <td>{master?.Stage?.find((s) => s.id === v.rec.stage_id)?.name}</td>
                      <td className="text-right tabular-nums">{calculateNetRc({ quantity: v.rec.quantity, pricePerSub: v.rec.price_per_sub, oc: v.rec.oc })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {importError && <p role="alert" className="text-sm text-red-600">{importError}</p>}
          {importProgress.total > 0 && <p role="status" className="text-sm text-muted-foreground">Batches {importProgress.completed}/{importProgress.total} · New {importProgress.imported} · Already imported {importProgress.existing}</p>}
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
          <p className="text-sm text-muted-foreground mt-1">{result?.ok + " newly imported · " + (result?.alreadyImported || 0) + " already imported · " + result?.fail + " failed"}</p>
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