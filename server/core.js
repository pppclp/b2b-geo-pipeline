// GEO backend core: routing, permissions, scope and row operations.
// Synchronous and free of Node APIs so the same code runs in:
//   - the local dev server (server/api.js, Excel files in data/)
//   - Apps Script (apps-script/, Google Sheets) — bundled by `npm run gas:build`
//
// store interface:
//   table(file, sheet) -> { headers: string[], rows: object[] }  (mutable)
//   touch(file, sheet)  — mark the table as changed so the adapter saves it
import { ENTITIES, toUi, toSheet, sheetCol, bool } from "./entities.js";
import { createOutputs } from "./outputs.js";
import { calculateNetRc } from "../src/lib/netRc.js";
import { normalizeClosureUpdate } from "./closure.js";
import { opportunityAuditEvents } from "./opportunityAudit.js";
import { buildSnapshotRows, replaceSnapshotPeriod, snapshotPeriodValid } from "./snapshot.js";
import { stripSystemFields, keepOpportunityColumns, isMonthKey, bangkokMonth } from "./opportunityPolicy.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isActive = (v) => v === "" || v == null || bool.toUi(v);

// Existing records without a unit price retain their original manual value
// until an AE/SM explicitly enters unit pricing. Never silently backfill.
function validateLatestOpportunityFields(data, { requireRequired = false } = {}) {
  const required = ["customer_name", "business_id", "customer_type", "sales_channel", "contact_name", "contact_phone", "product_category_id", "expected_close_month"];
  for (const key of required) {
    if ((requireRequired || key in data) && !String(data[key] ?? "").trim()) {
      throw new HttpError(400, key + " is required");
    }
  }
  if ("business_id" in data && data.business_id && !/^[0-9]+$/.test(String(data.business_id))) {
    throw new HttpError(400, "Business ID must contain digits only");
  }
  if ("sales_channel" in data && data.sales_channel && !["AE B2B GEO", "AE Self", "B2B Premium Partner"].includes(String(data.sales_channel))) {
    throw new HttpError(400, "Invalid Sales Channel");
  }
  if ("remark" in data && String(data.remark || "").length > 500) {
    throw new HttpError(400, "Remark exceeds 500 characters");
  }
  if ("ccp_check_result" in data && data.ccp_check_result && !["not_in_base", "enterprise_base", "pending"].includes(String(data.ccp_check_result))) {
    throw new HttpError(400, "Invalid CCP+ Check value");
  }
}

function normalizeOpportunityPricing(data, existing = null) {
  const merged = { ...(existing || {}), ...data };
  const hasPrice = merged.price_per_sub !== "" && merged.price_per_sub != null;
  if (!hasPrice) {
    if (!existing) throw new HttpError(400, "Price per Sub is required");
    if (["pipeline_value", "quantity", "oc"].some((k) => k in data && data[k] !== existing[k])) {
      throw new HttpError(400, "Enter Price per Sub before changing legacy financial values");
    }
    return { ...data };
  }
  try {
    return { ...data, pipeline_value: calculateNetRc({
      quantity: merged.quantity,
      pricePerSub: merged.price_per_sub,
      oc: merged.oc,
    }) };
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}

export function createCore({ contract, store, now, uuid }) {
  const ac = contract.access;
  const bindings = {}; // yaml entity -> { file, sheet, ...rule }
  const sheetRules = {}; // "file/sheet" -> { file, sheet, ...rule }
  const excluded = new Set(ac.excluded_sheets || []);
  for (const [file, f] of Object.entries(ac.files)) {
    for (const [sheet, rule] of Object.entries(f.sheets || {})) {
      if (excluded.has(sheet)) continue;
      bindings[rule.entity] = sheetRules[`${file}/${sheet}`] = { file, sheet, ...rule };
    }
  }

  const tableOf = (b) => store.table(b.file, b.sheet);
  const rows = (entity) => (bindings[entity] ? tableOf(bindings[entity]).rows : []);
  const outputs = createOutputs({ contract, store, rows, now, uuid, log: (m) => console.warn(m) });
  const touch = (b) => store.touch(b.file, b.sheet);
  // YAML stores uppercase role labels; the UI and actor use lowercase labels.
  const normalizeRole = (v) => String(v || "").trim().toLowerCase();
  const can = (role, rule, action) =>
    (rule.permissions?.[action] || []).some((allowed) => normalizeRole(allowed) === normalizeRole(role));
  const scopeForRole = (role) => {
    const key = Object.keys(ac.scope || {}).find((k) => normalizeRole(k) === normalizeRole(role));
    return key ? ac.scope[key] : "own";
  };
  const need = (actor, b, action) => {
    if (!can(actor.role, b, action)) throw new HttpError(403, `${actor.role} cannot ${action} ${b.sheet}`);
  };

  function binding(uiEntity) {
    const def = ENTITIES[uiEntity];
    if (!def) throw new HttpError(404, `Unknown entity ${uiEntity}`);
    const b = bindings[def.entity];
    if (!b) throw new HttpError(500, `Entity ${def.entity} is not bound to a file in access_control`);
    return b;
  }

  // Next ID following the sheet's existing pattern (CAT001 -> CAT002, OPP-1012 -> OPP-1013).
  function nextId(b, fallbackPrefix) {
    const existing = new Set(tableOf(b).rows.map((r) => String(r[b.primary_key])));
    let best = null;
    for (const id of existing) {
      const m = id.match(/^(.*?)(\d+)$/);
      if (m && (!best || Number(m[2]) > best.n)) best = { prefix: m[1], n: Number(m[2]), width: m[2].length };
    }
    if (best) {
      let n = best.n + 1;
      while (existing.has(best.prefix + String(n).padStart(best.width, "0"))) n++;
      return best.prefix + String(n).padStart(best.width, "0");
    }
    // Empty sheet: start a sequence (OPP000001). The UUID guards the unlikely no-prefix case.
    return fallbackPrefix ? `${fallbackPrefix}000001` : `ID-${uuid().slice(0, 8).toUpperCase()}`;
  }

  // ---- Identity ----
  function regionIdsFor(userId) {
    return rows("user_regions")
      .filter((r) => r.user_id === userId && isActive(r.active))
      .map((r) => r.region_id);
  }

  function findUser(userId) {
    if (!userId) return null;
    const u = rows("users").find((r) => r.user_id === userId);
    if (!u || String(u.status || "Active").toLowerCase() !== "active") return null;
    return { id: u.user_id, name: u.display_name, email: u.email, role: normalizeRole(u.role), region_ids: regionIdsFor(u.user_id) };
  }

  function findUserByEmployeeId(employeeId) {
    const username = String(employeeId || "").trim();
    if (!username) return null;
    const u = rows("users").find((r) => String(r.employee_id ?? "").trim() === username);
    return u ? findUser(u.user_id) : null;
  }

  function verifyUatCredential(username, password) {
    const key = String(username ?? "").trim();
    const supplied = String(password ?? "");
    if (!key || !supplied) return false;
    const row = rows("uat_credentials").find((r) => {
      const raw = r["employee_id / username"] ?? r.employee_id_username ?? "";
      return String(raw).trim() === key;
    });
    if (!row) return false;
    return String(row.temporary_password ?? "") === supplied;
  }

  function actorFrom(userId, demoAs) {
    const real = findUser(userId);
    if (!real) throw new HttpError(401, "Not signed in");
    if (demoAs && demoAs !== real.id && (ac.demo_as_allowed_for || []).some((role) => normalizeRole(role) === real.role)) {
      const demo = findUser(demoAs);
      if (demo) return { ...demo, real };
    }
    return { ...real, real };
  }

  // ---- Row scope ----
  function scopeFn(actor) {
    const scope = scopeForRole(actor.role);
    if (scope === "all") return () => true;
    if (scope === "region") {
      if (actor.role === "management" && !actor.region_ids.length) return () => true;
      return (r) => actor.region_ids.includes(r.region_id);
    }
    return (r) => r.owner_user_id === actor.id || r.current_handler_user_id === actor.id;
  }

  function scopedFilter(b, actor) {
    if (!b.scoped) return () => true;
    const inScope = scopeFn(actor);
    if (b.entity === "opportunity_events") {
      const allowed = new Set(rows("opportunities").filter(inScope).map((o) => o.opportunity_id));
      return (r) => allowed.has(r.opportunity_id);
    }
    return inScope; // opportunities, monthly_snapshots
  }

  // ---- Name <-> ID for fields the UI keeps as display names ----
  const NAME_REFS = {
    working_with: { entity: "working_with_options", id: "team_id", name: "team_name" },
    support_type: { entity: "support_types", id: "support_type_id", name: "support_type_name" },
  };
  function refLookup(field, from, to, value) {
    if (!value) return value;
    const ref = NAME_REFS[field];
    const hit = rows(ref.entity).find((r) => String(r[ref[from]]) === String(value));
    return hit ? hit[ref[to]] : value;
  }
  function namesToIds(uiEntity, data) {
    if (uiEntity !== "Opportunity") return data;
    const out = { ...data };
    for (const f of Object.keys(NAME_REFS)) if (f in out) out[f] = refLookup(f, "name", "id", out[f]);
    return out;
  }
  function decorate(uiEntity, rec) {
    if (uiEntity === "TeamMember") rec.region_ids = regionIdsFor(rec.id);
    if (uiEntity === "Opportunity") for (const f of Object.keys(NAME_REFS)) rec[f] = refLookup(f, "id", "name", rec[f]);
    return rec;
  }

  // Keep User_Region in sync when the UI edits TeamMember.region_ids.
  function syncUserRegions(userId, regionIds) {
    if (!Array.isArray(regionIds)) return;
    const b = bindings.user_regions;
    const t = tableOf(b);
    const current = t.rows.filter((r) => r.user_id === userId);
    t.rows = t.rows.filter((r) => r.user_id !== userId || regionIds.includes(r.region_id));
    regionIds.forEach((region_id, i) => {
      if (current.some((r) => r.region_id === region_id)) return;
      t.rows.push({
        [b.primary_key]: nextId(b, "UR"),
        user_id: userId,
        region_id,
        is_primary: bool.toSheet(i === 0 && !current.length),
        active: bool.toSheet(true),
        effective_from: now().slice(0, 10),
        effective_to: "",
      });
    });
    touch(b);
  }

  function validateStageSla(data) {
    if (!("sla_days" in data)) return;
    const v = data.sla_days;
    if (v === "" || v == null) return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      throw new HttpError(400, "Stage SLA must be 1-365 days or blank");
    }
  }

  // ---- AppConfig: key/value view over existing Aging_Settings (no new tab). ----
  const CONFIG_DEFAULTS = { pipeline_value_metric: "pipeline_value", weighted_enabled: "true" };
  function agingRow() {
    return rows("pipeline_settings").find((r) => isActive(r.active) && r.threshold_days !== "") || rows("pipeline_settings")[0];
  }
  function appConfigList() {
    const aging = agingRow();
    return [
      { id: "aging_threshold_days", key: "aging_threshold_days", value: String(aging?.threshold_days ?? 14), read_only: true },
      { id: "internal_task_sla_days", key: "internal_task_sla_days", value: String(aging?.internal_task_sla_days ?? "") },
      ...Object.entries(CONFIG_DEFAULTS).map(([key, value]) => ({ id: key, key, value, read_only: true })),
    ];
  }
  function appConfigSet(actor, key, value) {
    const b = bindings.pipeline_settings;
    need(actor, b, "update");
    if (key !== "internal_task_sla_days") throw new HttpError(400, `${key} is not editable (legacy threshold is read-only)`);
    const row = agingRow();
    if (!row) throw new HttpError(404, "Aging_Settings has no rows");
    if (value !== "" && value != null && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 365)) {
      throw new HttpError(400, "Internal SLA must be 1-365 days or blank");
    }
    const before = { ...row };
    row.internal_task_sla_days = value === "" || value == null ? "" : Number(value);
    // Existing Aging_Settings is a master workbook; Audit stays in Admin_Audit.
    outputs.logMaster("UPDATED", b, row[b.primary_key], before, row, actor);
    touch(b);
    return appConfigList().find((v) => v.key === key);
  }

  // Write authoritative audit records in the *same backend request* as the Pipeline.
  // Clients cannot author / modify / delete these events directly.
  function appendAudit(opportunityId, events, actor, stamp) {
    const b = bindings.opportunity_events;
    if (!b) throw new HttpError(500, "Pipeline_Events is not configured");
    const table = tableOf(b);
    return events.map((event) => {
      const row = {
        ...toSheet("OpportunityHistory", b.primary_key, event),
        [b.primary_key]: nextId(b, "EVT"),
        opportunity_id: opportunityId,
        actor_user_id: actor.real.id,
        actor_name: actor.real.name,
        event_at: stamp,
      };
      table.rows.push(row);
      touch(b);
      return toUi("OpportunityHistory", b.primary_key, row);
    });
  }

  function captureSnapshot(actor, snapshotPeriod) {
    const b = binding("MonthlySnapshot");
    need(actor, b, "create");
    if (!snapshotPeriodValid(snapshotPeriod)) throw new HttpError(400, "Snapshot period must be YYYY-MM");
    // Capture source from backend; NEVER trust a browser-supplied Pipeline list.
    const source = rows("opportunities");
    const stamp = now();
    const snapshots = buildSnapshotRows(source, snapshotPeriod, stamp, () => "SNP-" + uuid());
    if (!snapshots.length) throw new HttpError(409, "No eligible Pipelines; existing snapshot period was preserved");
    const table = tableOf(b);
    const replacement = replaceSnapshotPeriod(table.rows, snapshotPeriod, snapshots);
    // Validate and build the entire new state before touching the underlying sheet.
    table.rows = replacement;
    touch(b);
    return { captured: snapshots.length, snapshot_period: snapshotPeriod };
  }

  // ---- Entity API (used by the app screens) ----
  function matches(rec, query) {
    return Object.entries(query || {}).every(([k, v]) => String(rec[k] ?? "") === String(v));
  }
  function sortRows(list, sort) {
    if (!sort) return list;
    const desc = sort.startsWith("-");
    const key = desc ? sort.slice(1) : sort;
    return [...list].sort((a, b) => {
      const x = a[key] ?? "", y = b[key] ?? "";
      return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
    });
  }

  function findRow(b, actor, id) {
    const row = tableOf(b).rows.find((r) => String(r[b.primary_key]) === String(id));
    if (!row) throw new HttpError(404, `${b.sheet} ${id} not found`);
    if (!scopedFilter(b, actor)(row)) throw new HttpError(403, `${b.sheet} ${id} is outside your scope`);
    return row;
  }

  // Master (source) sheets keep their own columns: only write headers that
  // already exist or are defined in the YAML. App sheets may grow columns.
  function fitColumns(b, row) {
    if (b.scoped) return row;
    const allowed = new Set([...tableOf(b).headers, ...(contract.columns?.[b.entity] || [])]);
    return Object.fromEntries(Object.entries(row).filter(([k]) => allowed.has(k)));
  }

  function assertNotReferenced(b, id) {
    for (const ref of contract.references?.[b.entity] || []) {
      const used = rows(ref.entity).filter((r) => String(r[ref.col]) === String(id)).length;
      if (used) throw new HttpError(409, `${b.sheet} ${id} is still used by ${used} row(s) in ${bindings[ref.entity]?.sheet || ref.entity}.${ref.col} — deactivate it instead`);
    }
  }

  // Validate changed references only, allowing historical rows with retired
  // codes to receive unrelated updates. New values must be real and active.
  function validateOpportunityRefs(next, prev = null) {
    const changed = (col) => !prev || String(prev[col] ?? "") !== String(next[col] ?? "");
    const filled = (col) => String(next[col] ?? "").trim() !== "";
    const refs = [
      ["region_id", "regions", "Region"],
      ["territory_id", "territories", "Territory"],
      ["stage_id", "stages", "Stage"],
      ["product_category_id", "product_categories", "Product Category"],
      ["scenario_id", "scenarios", "Scenario"],
      ["working_with_id", "working_with_options", "Working With"],
      ["support_type_id", "support_types", "Support Type"],
    ];
    for (const [col, entity, label] of refs) {
      if (!changed(col)) continue;
      // A user must not remove a required reference from an existing record.
      if (["region_id", "stage_id", "product_category_id"].includes(col) && prev && filled(col) === false && filledPrev(prev, col)) {
        throw new HttpError(400, label + " is required");
      }
      if (!filled(col) || !bindings[entity]) continue;
      const b = bindings[entity];
      const master = rows(entity).find((r) => String(r[b.primary_key]) === String(next[col]));
      if (!master || !isActive(master.active)) {
        throw new HttpError(400, "Unknown or inactive " + label + ": " + next[col]);
      }
    }
    if (changed("expected_close_month") &&
        (!filled("expected_close_month") || !isMonthKey(String(next.expected_close_month)))) {
      throw new HttpError(400, "Expected Close Month must be YYYY-MM");
    }
    if ((changed("territory_id") || changed("region_id")) && filled("territory_id") && bindings.territories) {
      const t = rows("territories").find((r) => String(r.territory_id) === String(next.territory_id));
      if (t && t.region_id !== next.region_id) throw new HttpError(400, "Territory does not belong to the selected Region");
    }
    const regionChanged = changed("region_id");
    if (!filled("region_id")) throw new HttpError(400, "Region is required");
    if (changed("owner_user_id") || regionChanged) {
      const owner = findUser(next.owner_user_id);
      if (!owner || owner.role !== "ae") throw new HttpError(400, "Owner must be an active AE");
      if (!owner.region_ids.includes(String(next.region_id))) {
        throw new HttpError(400, "Owner AE is not assigned to this Pipeline's Region");
      }
    }
    if (changed("current_handler_user_id") || regionChanged) {
      const handler = findUser(next.current_handler_user_id || next.owner_user_id);
      if (!handler || !["ae", "sm"].includes(handler.role)) {
        throw new HttpError(400, "Current Handler must be an active AE or SM");
      }
      if (!handler.region_ids.includes(String(next.region_id))) {
        throw new HttpError(400, "Current Handler is not assigned to this Pipeline's Region");
      }
    }
  }
  const filledPrev = (rec, col) => String(rec?.[col] ?? "").trim() !== "";

  // Derived timestamps can never be sent by the browser. Each SLA clock
  // changes only with its associated business field.
  function applyOpportunityTimers(changes, before, stamp) {
    const differs = (field) => field in changes && String(changes[field] ?? "") !== String(before[field] ?? "");
    if (differs("stage_id")) changes.stage_entered_at = stamp;
    if (differs("current_handler_user_id")) changes.handler_since = stamp;
    if (differs("working_with_id")) changes.working_with_since = changes.working_with_id ? stamp : "";
    return changes;
  }

  const entityApi = {
    list(uiEntity, actor, { sort, limit, query } = {}) {
      const b = binding(uiEntity);
      need(actor, b, "read");
      if (ENTITIES[uiEntity].virtual) return appConfigList();
      const inScope = scopedFilter(b, actor);
      let out = tableOf(b).rows.filter(inScope).map((r) => decorate(uiEntity, toUi(uiEntity, b.primary_key, r)));
      out = sortRows(out.filter((r) => matches(r, query)), sort);
      return limit ? out.slice(0, Number(limit)) : out;
    },
    get(uiEntity, actor, id) {
      const b = binding(uiEntity);
      need(actor, b, "read");
      if (ENTITIES[uiEntity].virtual) return appConfigList().find((c) => c.id === id);
      return decorate(uiEntity, toUi(uiEntity, b.primary_key, findRow(b, actor, id)));
    },
    create(uiEntity, actor, data) {
      const b = binding(uiEntity);
      if (ENTITIES[uiEntity].virtual) return appConfigSet(actor, data.key, data.value);
      need(actor, b, "create");
      if (uiEntity === "OpportunityHistory" || uiEntity === "MonthlySnapshot") {
        throw new HttpError(403, "System-controlled entity; use the Pipeline or snapshot API");
      }
      if (uiEntity === "Stage") validateStageSla(data);
      const stamp = now();
      if (uiEntity === "Opportunity") {
        data = stripSystemFields(data);
        // New Pipelines always start Open. Close them via the audited
        // Won/Lost update flow, which requires a Lost Reason when applicable.
        if (String(data.status || "open").toLowerCase() !== "open") {
          throw new HttpError(400, "Create Pipeline as Open, then use Mark Won or Mark Lost");
        }
        // New AE modal fields must be validated server-side as well.
        // Imported historical data without sales_channel is handled separately.
        if (actor.role === "ae" && (data.scenario_id || data.ccp_check_result)) {
          throw new HttpError(403, "Only SM or Management can set Scenario and CCP+ Check");
        }
        if (actor.role === "ae" && String(data.owner_id || "") !== String(actor.id)) {
          throw new HttpError(403, "AE must create Pipelines owned by their own account");
        }
        validateLatestOpportunityFields(data, { requireRequired: "sales_channel" in data });
      }
      const checked = uiEntity === "Opportunity" ? normalizeOpportunityPricing(data) : data;
      let row = toSheet(uiEntity, b.primary_key, namesToIds(uiEntity, checked));
      if (b.entity === "opportunities") {
        row = keepOpportunityColumns(row);
        row.status = "Open";
        row.current_handler_user_id = row.current_handler_user_id || row.owner_user_id;
        row.original_owner_user_id = row.owner_user_id;
        row.created_month = bangkokMonth(stamp);
        row.stage_entered_at = stamp;
        row.handler_since = stamp;
        row.working_with_since = row.working_with_id ? stamp : "";
        validateOpportunityRefs(row);
      }
      row[b.primary_key] = nextId(b, ENTITIES[uiEntity].idPrefix);
      if (b.append_only) {
        // Events are system records: actor and time are set by the backend.
        row.actor_user_id = actor.real.id;
        row.actor_name = actor.real.name;
        row.event_at = stamp;
      } else {
        row.created_at = stamp;
        row.updated_at = stamp;
      }
      if (b.entity === "opportunities") row.created_by_user_id = actor.real.id;
      if (b.scoped && !scopedFilter(b, actor)(row)) throw new HttpError(403, `New ${b.sheet} row would be outside your scope`);
      const saved = fitColumns(b, row);
      tableOf(b).rows.push(saved);
      touch(b);
      if (uiEntity === "TeamMember") syncUserRegions(row[b.primary_key], data.region_ids);
      const auditEvents = b.entity === "opportunities"
        ? appendAudit(saved[b.primary_key], opportunityAuditEvents(null, saved), actor, stamp)
        : [];
      if (b.entity !== "opportunities" && !b.scoped) outputs.logMaster("CREATED", b, saved[b.primary_key], null, saved, actor);
      const created = decorate(uiEntity, toUi(uiEntity, b.primary_key, row));
      return b.entity === "opportunities" ? { ...created, _audit_events: auditEvents } : created;
    },
    update(uiEntity, actor, id, data) {
      const b = binding(uiEntity);
      if (ENTITIES[uiEntity].virtual) return appConfigSet(actor, id, data.value);
      need(actor, b, "update");
      if (uiEntity === "OpportunityHistory" || uiEntity === "MonthlySnapshot") {
        throw new HttpError(403, "System-controlled entity");
      }
      if (uiEntity === "Stage") validateStageSla(data);
      if (uiEntity === "Opportunity") data = stripSystemFields(data);
      const row = findRow(b, actor, id);
      const before = { ...row };
      if (uiEntity === "Opportunity" && actor.role === "ae") {
        const current = toUi(uiEntity, b.primary_key, row);
        if ("owner_id" in data && String(data.owner_id) !== String(current.owner_id)) {
          throw new HttpError(403, "Only SM or Admin may reassign commercial ownership");
        }
        for (const field of ["scenario_id", "ccp_check_result"]) {
          if (field in data && String(data[field] || "") !== String(current[field] || "")) {
            throw new HttpError(403, "Only SM or Management can update " + field);
          }
        }
      }
      // Validate latest editable fields on partial updates without breaking
      // workflow-only updates such as Stage / Handler / Support.
      if (uiEntity === "Opportunity") validateLatestOpportunityFields(data);

      // Validate loss reason and close only an Open Pipeline. The real actor
      // and timestamp are taken from the backend, never from the browser.
      let normalized = data;
      if (uiEntity === "Opportunity") {
        try {
          normalized = normalizeClosureUpdate(
            data,
            toUi(uiEntity, b.primary_key, row),
            rows("lost_reasons"),
            actor.real.id,
            now()
          );
        } catch (error) {
          throw new HttpError(400, error.message);
        }
      }
      const checked = uiEntity === "Opportunity"
        ? normalizeOpportunityPricing(normalized, toUi(uiEntity, b.primary_key, row))
        : data;
      let changes = toSheet(uiEntity, b.primary_key, namesToIds(uiEntity, checked));
      delete changes[b.primary_key];
      // Free-text audit remark is metadata, never a Pipeline column.
      delete changes.audit_remark;
      const stamp = now();
      if (b.entity === "opportunities") {
        changes = applyOpportunityTimers(keepOpportunityColumns(changes), row, stamp);
        const next = { ...row, ...changes };
        validateOpportunityRefs(next, row);
        // Do not let Region changes move the row out of the editor's scope.
        if (String(next.region_id ?? "") !== String(row.region_id ?? "") &&
            !scopedFilter(b, actor)(next)) {
          throw new HttpError(403, "Region change would move Pipeline outside your scope");
        }
      }
      Object.assign(row, fitColumns(b, { ...changes, updated_at: stamp }));
      touch(b);
      const auditEvents = b.entity === "opportunities"
        ? appendAudit(id, opportunityAuditEvents(before, row, { remark: data.audit_remark || data.last_remark || "" }), actor, stamp)
        : [];
      if (uiEntity === "TeamMember") syncUserRegions(id, data.region_ids);
      if (b.entity !== "opportunities" && !b.scoped) outputs.logMaster("UPDATED", b, id, before, row, actor);
      const updated = decorate(uiEntity, toUi(uiEntity, b.primary_key, row));
      return b.entity === "opportunities" ? { ...updated, _audit_events: auditEvents } : updated;
    },
    remove(uiEntity, actor, id) {
      const b = binding(uiEntity);
      need(actor, b, "delete");
      if (uiEntity === "OpportunityHistory" || uiEntity === "MonthlySnapshot") {
        throw new HttpError(403, "System-controlled entity");
      }
      const row = findRow(b, actor, id);
      assertNotReferenced(b, id);
      const t = tableOf(b);
      t.rows = t.rows.filter((r) => r !== row);
      touch(b);
      if (b.entity !== "opportunities" && !b.scoped) outputs.logMaster("DELETED", b, id, row, null, actor);
      return { ok: true };
    },
    removeMany(uiEntity, actor, query) {
      const b = binding(uiEntity);
      need(actor, b, "delete");
      if (uiEntity === "OpportunityHistory" || uiEntity === "MonthlySnapshot") {
        throw new HttpError(403, "System-controlled entity");
      }
      const inScope = scopedFilter(b, actor);
      const sheetQuery = Object.fromEntries(Object.entries(query || {}).map(([k, v]) => [sheetCol(uiEntity, k), v]));
      const t = tableOf(b);
      const before = t.rows.length;
      t.rows = t.rows.filter((r) => !(inScope(r) && matches(r, sheetQuery)));
      touch(b);
      return { deleted: before - t.rows.length };
    },
  };

  // ---- Sheet API (generic row editor over any sheet bound in access_control) ----
  const actionsFor = (actor, rule) => Object.keys(rule.permissions || {}).filter((a) => can(actor.role, rule, a));
  function sheetRule(file, sheet) {
    const rule = sheetRules[`${file}/${sheet}`];
    if (!rule) throw new HttpError(404, `${file} / ${sheet} is not available (not listed in access_control)`);
    return rule;
  }
  // Keep IDs and codes as text; convert plain numbers typed into the editor.
  const cellIn = (v) => (typeof v === "string" && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v.trim()) ? Number(v) : v ?? "");

  const sheetApi = {
    list(actor) {
      return Object.values(sheetRules)
        .map((r) => ({
          file: r.file,
          sheet: r.sheet,
          entity: r.entity,
          primary_key: r.primary_key,
          app_maintained: !!(r.scoped || r.append_only),
          actions: actionsFor(actor, r),
        }))
        .filter((s) => s.actions.includes("read"));
    },
    read(actor, file, sheet) {
      const b = sheetRule(file, sheet);
      need(actor, b, "read");
      const t = tableOf(b);
      const headers = t.headers.length ? t.headers : contract.columns?.[b.entity] || [b.primary_key];
      return { file, sheet, primary_key: b.primary_key, headers, rows: t.rows.filter(scopedFilter(b, actor)), actions: actionsFor(actor, b) };
    },
    create(actor, file, sheet, data) {
      const b = sheetRule(file, sheet);
      need(actor, b, "create");
      if (b.append_only || b.scoped) throw new HttpError(400, `${sheet} is maintained by the app — edit it from the Pipeline screens`);
      const t = tableOf(b);
      const row = Object.fromEntries(Object.entries(fitColumns(b, data || {})).map(([k, v]) => [k, cellIn(v)]));
      const id = String(row[b.primary_key] ?? "").trim() || nextId(b);
      if (t.rows.some((r) => String(r[b.primary_key]) === id)) throw new HttpError(409, `${b.primary_key} ${id} already exists`);
      row[b.primary_key] = id;
      t.rows.push(row);
      touch(b);
      outputs.logMaster("CREATED", b, id, null, row, actor);
      return row;
    },
    update(actor, file, sheet, id, data) {
      const b = sheetRule(file, sheet);
      need(actor, b, "update");
      if (b.append_only || b.scoped) throw new HttpError(400, `${sheet} is maintained by the app — edit it from the Pipeline screens`);
      const row = findRow(b, actor, id);
      const before = { ...row };
      for (const [k, v] of Object.entries(fitColumns(b, data || {}))) if (k !== b.primary_key) row[k] = cellIn(v);
      touch(b);
      outputs.logMaster("UPDATED", b, id, before, row, actor);
      return row;
    },
    remove(actor, file, sheet, id) {
      const b = sheetRule(file, sheet);
      need(actor, b, "delete");
      if (b.append_only || b.scoped) throw new HttpError(400, `${sheet} is maintained by the app — edit it from the Pipeline screens`);
      const row = findRow(b, actor, id);
      assertNotReferenced(b, id);
      const t = tableOf(b);
      t.rows = t.rows.filter((r) => r !== row);
      touch(b);
      outputs.logMaster("DELETED", b, id, row, null, actor);
      return { ok: true };
    },
  };

  // ---- Router ----
  // req: { method, path: "entities/Opportunity/OPP-1", query: {}, body, userId, demoAs }
  function handle(req) {
    const parts = String(req.path || "").split("/").filter(Boolean).map(decodeURIComponent);
    const method = req.method || "GET";
    const query = req.query || {};
    const q = query.q ? (typeof query.q === "string" ? JSON.parse(query.q) : query.q) : undefined;

    // UAT password gate only: validate Employee ID + temporary password,
    // then continue using the existing user-id based app flow.
    if (parts[0] === "session" && parts[1] === "login" && method === "POST") {
      const username = String(req.body?.username || "").trim();
      const password = String(req.body?.password || "");
      const user = findUserByEmployeeId(username);
      if (!user || !verifyUatCredential(username, password)) {
        throw new HttpError(401, "Invalid username or password");
      }
      return { user_id: user.id, id: user.id, full_name: user.name, role: user.role };
    }

    // Dev sign-in list. Kept for local troubleshooting; the UAT UI no longer uses it.
    if (parts[0] === "session" && parts[1] === "users" && method === "GET") {
      return rows("users")
        .filter((u) => String(u.status || "Active").toLowerCase() === "active")
        .map((u) => ({ id: u.user_id, name: u.display_name, email: u.email, role: u.role }));
    }

    // Several read requests in one round trip (Apps Script calls are slow): { requests: [{ path, query }] }
    if (parts[0] === "batch") {
      const requests = (req.body && req.body.requests) || [];
      return requests.map((sub) => {
        try {
          return { status: 200, body: handle({ ...sub, method: "GET", userId: req.userId, demoAs: req.demoAs }) };
        } catch (e) {
          if (!e.status) throw e;
          return { status: e.status, body: { message: e.message } };
        }
      });
    }

    const actor = actorFrom(req.userId, req.demoAs);

    if (parts[0] === "session" && parts[1] === "me") {
      const r = actor.real;
      return { id: r.id, email: r.email, full_name: r.name, role: r.role };
    }

    if (parts[0] === "access" && method === "GET") {
      const allowed = {};
      for (const [file, f] of Object.entries(ac.files)) {
        allowed[file] = {};
        for (const sheet of Object.keys(f.sheets || {})) allowed[file][sheet] = actionsFor(actor, sheetRules[`${file}/${sheet}`]);
        if (f.permissions) allowed[file]._file = Object.keys(f.permissions).filter((a) => (f.permissions[a] || []).includes(actor.role));
      }
      return { role: actor.role, scope: scopeForRole(actor.role), allowed };
    }

    if (parts[0] === "exports") {
      if (parts[1] === "pipelines" && method === "GET") {
        const b = binding("Opportunity");
        need(actor, b, "read");
        need(actor, b, "export");
        // The backend enforces own/region/all scopes independently of the UI.
        return entityApi.list("Opportunity", actor);
      }
      throw new HttpError(404, "Unknown export command");
    }

    if (parts[0] === "snapshots") {
      if (parts[1] === "capture" && method === "POST") {
        return captureSnapshot(actor, req.body?.snapshot_period);
      }
      throw new HttpError(404, "Unknown snapshot command");
    }

    if (parts[0] === "entities" && parts[1]) {
      const [, entity, id] = parts;
      if (method === "GET" && !id) return entityApi.list(entity, actor, { sort: query.sort, limit: query.limit, query: q });
      if (method === "GET") return entityApi.get(entity, actor, id);
      if (method === "POST" && id === "bulk") {
        if (entity === "Opportunity" || entity === "OpportunityHistory" || entity === "MonthlySnapshot") {
          throw new HttpError(403, "Bulk mutation is disabled for transactional entities");
        }
        return (req.body || []).map((item) => entityApi.create(entity, actor, item));
      }
      if (method === "POST") return entityApi.create(entity, actor, req.body || {});
      if (method === "PUT" && id) return entityApi.update(entity, actor, id, req.body || {});
      if (method === "DELETE" && id) return entityApi.remove(entity, actor, id);
      if (method === "DELETE") return entityApi.removeMany(entity, actor, q);
    }

    if (parts[0] === "sheets") {
      const [, file, sheet, id] = parts;
      if (!file && method === "GET") return sheetApi.list(actor);
      if (file && sheet) {
        if (method === "GET") return sheetApi.read(actor, file, sheet);
        if (method === "POST") return sheetApi.create(actor, file, sheet, req.body);
        if (method === "PUT" && id) return sheetApi.update(actor, file, sheet, id, req.body);
        if (method === "DELETE" && id) return sheetApi.remove(actor, file, sheet, id);
      }
    }

    throw new HttpError(404, `No route for ${method} /${parts.join("/")}`);
  }

  return { handle, bindings };
}
