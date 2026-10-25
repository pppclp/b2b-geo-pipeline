// Persist Admin master-data changes in the canonical Pipeline DB.
// Pipelines and Pipeline_Events are saved by core.js. Month-end snapshots are
// captured from canonical Pipeline data. No Export Template Sheet is a runtime
// write target: downloadable reports are derived on demand from DB tables.
//
// The Admin_Audit table lives in the SAME B2B_GEO_Pipeline_DB workbook as
// Pipelines / Pipeline_Events / Snapshots. It is restricted to Admin readers.
// Master source workbooks are still separate in the UAT architecture; Google
// Sheets cannot provide ACID transactions across different spreadsheet files.

const AUDIT_FILE = "B2B_GEO_Pipeline_DB.xlsx";
const AUDIT_SHEET = "Admin_Audit";
const AUDIT_ENTITY = "admin_audit";
export const ADMIN_AUDIT_COLUMNS = [
  "audit_id", "event_type", "source_file", "source_sheet",
  "source_record_id", "field_name", "previous_value", "new_value",
  "actor_user_id", "actor_name", "actor_role", "event_at",
];

const serialize = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

function deltas(kind, binding, before, after) {
  if (kind === "UPDATED") {
    const fields = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    return [...fields]
      .filter((field) => !["updated_at", "created_at"].includes(field))
      .filter((field) => serialize(before?.[field]) !== serialize(after?.[field]))
      .sort()
      .map((field) => ({
        field_name: field,
        previous_value: serialize(before?.[field]),
        new_value: serialize(after?.[field]),
      }));
  }
  // Create/delete must capture the full record, not just the primary key:
  // otherwise a deleted master row cannot be reconstructed from its audit.
  if (kind === "CREATED" || kind === "DELETED") {
    return [{
      field_name: binding.primary_key,
      previous_value: kind === "DELETED" ? JSON.stringify(before || {}) : "",
      new_value: kind === "CREATED" ? JSON.stringify(after || {}) : "",
    }];
  }
  throw new Error("Unrecognized master audit operation: " + kind);
}

export function createOutputs({ contract, store, now, uuid }) {
  const auditBinding = contract?.access?.files?.[AUDIT_FILE]?.sheets?.[AUDIT_SHEET];

  function logMaster(kind, binding, recordId, before, after, actor) {
    const changes = deltas(kind, binding, before, after);
    if (!changes.length) return []; // unchanged fields should not create events
    if (!auditBinding || auditBinding.entity !== AUDIT_ENTITY ||
        auditBinding.primary_key !== "audit_id") {
      throw new Error("Admin_Audit is not configured in the Pipeline DB YAML contract");
    }
    if (!actor?.real?.id) throw new Error("Verified actor required for Admin Audit");
    const table = store.table(AUDIT_FILE, AUDIT_SHEET);
    if (!table) throw new Error("Admin_Audit DB table unavailable");
    if (!table.headers.length) table.headers = [...ADMIN_AUDIT_COLUMNS];

    const seen = new Set(table.rows.map((r) => String(r.audit_id)));
    const stamp = now();
    const entries = changes.map((change) => {
      // UAT fixtures can use deterministic UUIDs; disambiguate safely.
      const base = "ADM-" + uuid();
      let id = base, counter = 1;
      while (seen.has(id)) id = base + "-" + counter++;
      seen.add(id);
      return {
        audit_id: id,
        event_type: "MASTER_" + kind,
        source_file: binding.file,
        source_sheet: binding.sheet,
        source_record_id: String(recordId ?? ""),
        ...change,
        actor_user_id: actor.real.id,
        actor_name: actor.real.name || "",
        actor_role: actor.real.role || "",
        event_at: stamp,
      };
    });
    table.rows.push(...entries);
    store.touch(AUDIT_FILE, AUDIT_SHEET); // critical DB workbook, not derived export
    return entries;
  }

  // Scheduled jobs must never masquerade as the first human Admin.
  // Persist one server-owned provenance record in the existing Admin_Audit table.
  function logScheduledSnapshot(snapshotPeriod, count, actorId = "SYSTEM_MONTH_END") {
    if (!auditBinding || auditBinding.entity !== AUDIT_ENTITY ||
        auditBinding.primary_key !== "audit_id") throw new Error("Admin_Audit required for scheduled snapshot provenance");
    const table = store.table(AUDIT_FILE, AUDIT_SHEET);
    if (!table.headers.length) throw new Error("Admin_Audit headers missing");
    const existing = new Set(table.rows.map(r => String(r.audit_id)));
    const base = "ADM-" + uuid();
    let id = base, i = 1;
    while (existing.has(id)) id = base + "-" + i++;
    table.rows.push({
      audit_id: id, event_type: "SNAPSHOT_AUTO_CAPTURE",
      source_file: AUDIT_FILE, source_sheet: "Snapshots", source_record_id: snapshotPeriod,
      field_name: "snapshot_period", previous_value: "", new_value: String(count),
      actor_user_id: actorId, actor_name: "Scheduled Snapshot", actor_role: "system",
      event_at: now(),
    });
    store.touch(AUDIT_FILE, AUDIT_SHEET);
  }

  return { logMaster, logScheduledSnapshot };
}
