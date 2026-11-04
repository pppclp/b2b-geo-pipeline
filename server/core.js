// GEO backend core: routing, permissions, scope and row operations.
// Synchronous and free of Node APIs so the same code runs in:
//   - the local dev server (server/api.js, Excel files in data/)
//   - Apps Script (apps-script/, Google Sheets) — bundled by `npm run gas:build`
//
// store interface:
//   table(file, sheet) -> { headers: string[], rows: object[] }  (mutable)
//   touch(file, sheet)  — mark the table as changed so the adapter saves it
import { ENTITIES, toUi, toSheet, sheetCol, bool } from "./entities.js";
import { normalizeSalesChannel } from "../src/lib/salesChannel.js";
import { createOutputs } from "./outputs.js";
import { calculateNetRc } from "../src/lib/netRc.js";
import { businessIdError, normalizeCustomerType, netRcReconciliation } from "../src/lib/pipelineValidation.js";
import { API_CONTRACT_VERSION, REQUIRED_CAPABILITIES, UAT_EMAIL_ACTIVATION_CAPABILITY } from "../src/lib/apiContract.js";
import { normalizeClosureUpdate } from "./closure.js";
import { opportunityAuditEvents } from "./opportunityAudit.js";
import { workingWithStartByTeam, livePipelineAlertState } from "./livePipelineAlerts.js";
import { buildTeamActivityLog } from "./activityLog.js";
import { buildSnapshotRows, replaceSnapshotPeriod, snapshotPeriodValid } from "./snapshot.js";
import { stripSystemFields, keepOpportunityColumns, isMonthKey, bangkokMonth } from "./opportunityPolicy.js";
import { pipelineTaskViews, validDays } from "../src/lib/taskOverdue.js";
import { approvedUndatedHistoricalCancel } from "../src/lib/approvedHistoricalCancel.js";
import { approvedHistoricalStage3 } from "../src/lib/approvedHistoricalStage3.js";
import { normalizeHistoricalDate, normalizeHistoricalMonth } from "../src/lib/historicalDateNormalization.js";
import { historicalRegionForWorkbook, originalSourceIdentity } from "../src/lib/historicalSourceIdentity.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isActive = (v) => v === "" || v == null || bool.toUi(v);
// Recycle Bin is independent of Open/Won/Lost/Archived; the original status
// remains intact and Pipelines + immutable Events are never physically deleted.
const isSoftDeleted = (row) => Boolean(String(row?.deleted_at || "").trim());

// Existing records without a unit price retain their original manual value
// until an AE/SM explicitly enters unit pricing. Never silently backfill.
function validateLatestOpportunityFields(data, { requireRequired = false, previousBusinessId = null, additionalCustomerTypes = [], allowedSalesChannels = [], legacyImport = false } = {}) {
  const required = ["customer_name", "customer_type", "sales_channel", "product_category_id", "expected_close_month"];
  for (const key of required) {
    // Historical blanks are preserved and surfaced in Incomplete Data.
    if (legacyImport && (key === "expected_close_month" || key === "sales_channel")) continue;
    if ((requireRequired || key in data) && !String(data[key] ?? "").trim()) {
      throw new HttpError(400, key + " is required");
    }
  }
  if (legacyImport && data.business_id != null && String(data.business_id).length > 40)
    throw new HttpError(400, "Historical Business ID must be at most 40 characters; preserve raw value");
  if (!legacyImport && "business_id" in data && data.business_id &&
      (previousBusinessId === null || String(data.business_id) !== String(previousBusinessId))) {
    const error = businessIdError(data.business_id);
    if (error) throw new HttpError(400, error);
  }
  if ("customer_type" in data && data.customer_type && !normalizeCustomerType(data.customer_type) &&
      !additionalCustomerTypes.includes(String(data.customer_type).trim())) {
    throw new HttpError(400, "Invalid Customer Type. Choose a supported value.");
  }
  if ("sales_channel" in data && data.sales_channel && !allowedSalesChannels.includes(String(data.sales_channel))) {
    throw new HttpError(400, "Invalid Sales Channel");
  }
  // Bound each user-editable text field before Google Sheets receives the value.
  // Limits match ordinary sales usage; do not trim data silently on the server.
  const textLimits = {
    customer_name: 200, contact_name: 120, contact_phone: 40,
    customer_location_text: 500,
    partner_name: 200, product_details: 2000, remark: 500,
    support_note: 1000, lost_note: 1000, last_remark: 500,
  };
  for (const [field, limit] of Object.entries(textLimits)) {
    if (field in data && data[field] != null && String(data[field]).length > limit) {
      throw new HttpError(400, field + " exceeds " + limit + " characters");
    }
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
  // Editing a note or Stage must never silently reprice an existing deal.
  // Recalculate Net RC only when one of its inputs has genuinely changed.
  const repriced = !existing || ["quantity", "price_per_sub", "oc"].some(
    (k) => k in data && String(data[k] ?? "") !== String(existing[k] ?? "")
  );
  if (!repriced) {
    if ("pipeline_value" in data &&
        String(data.pipeline_value ?? "") !== String(existing.pipeline_value ?? "")) {
      throw new HttpError(400, "Pipeline Value is calculated from unit pricing");
    }
    const { pipeline_value: ignored, ...rest } = data;
    return rest;
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

// Import-only source dates must be genuine calendar days, never guessed from locale strings.
function validImportDate(value) {
  if (!value) return "";
  const v = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 2100 && date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? v : null;
}

export function createCore({ contract, store, now, uuid }) {
  const ac = contract.access;
  const bindings = {}; // yaml entity -> { file, sheet, ...rule }
  let teamEventIndex = null; // lazy read-only index, invalidated after audit writes
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
    // Retired UAT SupportType master has no runtime sheet dependency.
    if (uiEntity === "SupportType") throw new HttpError(410, "Support feature has been retired");
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
    const role = normalizeRole(u.role);
    // Nationwide Management scope is derived from the authorized Users.role,
    // not a mutable collection of per-Region grants. Keep the raw User_Region
    // rows unchanged for audit and admin master-data maintenance.
    const effectiveRegions = role === "management" && scopeForRole(role) === "all"
      ? rows("regions").filter((r) => isActive(r.active)).map((r) => r.region_id)
      : regionIdsFor(u.user_id);
    return { id: u.user_id, name: u.display_name, email: u.email, role, region_ids: effectiveRegions };
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
      // SM remains restricted to explicit active User_Region assignments.
      // Management/Admin reach their contract-defined nationwide "all" scope.
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
  // Identity used for sign-in must not leak via ordinary team directories.
  // Admin retains access for account provisioning; UI hiding alone is not a guard.
  // Restrict the actual server response, not merely the browser dropdown.
  // A member is visible when they share an active Region assignment, or are self.
  function directoryVisible(actor, userId) {
    if (["admin", "management"].includes(actor.role) || String(userId) === String(actor.id)) return true;
    const allowedRegions = new Set(actor.region_ids || []);
    return regionIdsFor(userId).some((id) => allowedRegions.has(id));
  }
  function visibleMember(actor, uiEntity, record) {
    if (uiEntity !== "TeamMember" || actor.role === "admin") return record;
    const { employee_id: ignored, ...publicMember } = record;
    return publicMember;
  }
  function visibleSheetRow(actor, b, record) {
    if (b.entity !== "users" || actor.role === "admin") return record;
    const { employee_id: ignored, ...publicMember } = record;
    return publicMember;
  }
  // Compute independent team clocks from existing append-only Pipeline_Events.
  // No Pipeline DB schema migration and no fabricated timestamps for imports.
  function teamEventsFor(opportunityId) {
    if (!teamEventIndex) {
      teamEventIndex = new Map();
      for (const event of rows("opportunity_events")) {
        if (!["working_with_teams", "working_with"].includes(String(event.field_name))) continue;
        const id = String(event.opportunity_id || "");
        if (!teamEventIndex.has(id)) teamEventIndex.set(id, []);
        teamEventIndex.get(id).push(event);
      }
    }
    return teamEventIndex.get(String(opportunityId)) || [];
  }
  function teamStartTimes(op) {
    // For all authorized rows, replay the real append-only Pipeline_Events.
    // No source-created-date assumptions or side effects on historical records.
    return workingWithStartByTeam(op, teamEventsFor(op.id), rows("working_with_options"));
  }
  function decorate(uiEntity, rec) {
    if (uiEntity === "TeamMember") rec.region_ids = regionIdsFor(rec.id);
    if (uiEntity === "OpportunityHistory") {
      const who = rows("users").find((user) => String(user.user_id) === String(rec.actor_id));
      rec.actor_name = who?.display_name || rec.actor_name || rec.actor_id || "";
    }
    if (uiEntity === "Opportunity") {
      // Retain the canonical primary team ID before converting its display name.
      rec.working_with_primary_id = String(rec.working_with || "");
      rec.working_with_team_since = teamStartTimes({ ...rec, working_with_id: rec.working_with_primary_id });
      // The GAS/Core backend is authoritative for SLA flags on every Pipeline.
      // Task-specific overdue is composed in the UI from the same Task records.
      rec.alert_state = livePipelineAlertState(rec, {
        stages: rows("stages"),
        users: rows("users"),
        teams: rows("working_with_options"),
        settings: agingRow() || {},
        teamStarts: rec.working_with_team_since,
        now: now(),
      });
      for (const f of Object.keys(NAME_REFS)) rec[f] = refLookup(f, "id", "name", rec[f]);
    }
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

  // User Master is an authorization source, not just a free-form Sheet.
  // Both the entity API and generic Source Sheets editor must obey these rules.
  const ALLOWED_USER_ROLES = new Set(["AE", "SM", "Management", "Admin"]);
  const ALLOWED_USER_STATUSES = new Set(["Active", "Inactive"]);
  const AUTH_USER_FIELDS = new Set(["user_id", "employee_id", "role", "status"]);
  function validateUserMasterChange(data, previous = null) {
    const next = { ...(previous || {}), ...(data || {}) };
    // Keep existing account fields stable on unrelated edits, but validate all
    // explicit privilege changes and new account roles/statuses.
    if ((!previous || "role" in data) && !ALLOWED_USER_ROLES.has(String(next.role || ""))) {
      throw new HttpError(400, "Users.role must be AE, SM, Management or Admin");
    }
    if ((!previous || "status" in data) && !ALLOWED_USER_STATUSES.has(String(next.status || ""))) {
      throw new HttpError(400, "Users.status must be Active or Inactive");
    }
    if ((!previous || "employee_id" in data) && next.employee_id) {
      const employeeId = String(next.employee_id).trim();
      if (!employeeId) throw new HttpError(400, "Employee ID cannot be blank");
      if (rows("users").some((u) => u.user_id !== next.user_id && String(u.employee_id || "").trim() === employeeId)) {
        throw new HttpError(409, "Employee ID is already assigned to another user");
      }
    }
    return next;
  }

  // The TeamMember UI uses lowercase roles and boolean 'active'; validate
  // before adapters coerce unknown values into a legitimate role/status.
  function validateTeamMemberInput(input) {
    if ("app_role" in input && !["ae", "sm", "management", "admin"].includes(String(input.app_role))) {
      throw new HttpError(400, "Invalid Team Member role");
    }
    if ("active" in input && typeof input.active !== "boolean") {
      throw new HttpError(400, "Team Member active must be true or false");
    }
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
      { id: "stage_watch_days", key: "stage_watch_days", value: String(aging?.stage_watch_days ?? 7) },
      { id: "handler_ae_sla_days", key: "handler_ae_sla_days", value: String(aging?.handler_ae_sla_days ?? aging?.handler_aging_days ?? "") },
      { id: "handler_sm_sla_days", key: "handler_sm_sla_days", value: String(aging?.handler_sm_sla_days ?? aging?.handler_aging_days ?? "") },
      ...Object.entries(CONFIG_DEFAULTS).map(([key, value]) => ({ id: key, key, value, read_only: true })),
    ];
  }
  function appConfigSet(actor, key, value) {
    const b = bindings.pipeline_settings;
    need(actor, b, "update");
    if (!["internal_task_sla_days","stage_watch_days","handler_ae_sla_days","handler_sm_sla_days"].includes(key)) throw new HttpError(400, `${key} is not editable`);
    const row = agingRow();
    if (!row) throw new HttpError(404, "Aging_Settings has no rows");
    if ((key !== "internal_task_sla_days" || (value !== "" && value != null)) && validDays(value) === null) {
      throw new HttpError(400, `${key} must be 1-365 calendar days`);
    }
    const before = { ...row };
    row[key] = key === "internal_task_sla_days" && (value === "" || value == null) ? "" : Number(value);
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
      teamEventIndex = null;
      return toUi("OpportunityHistory", b.primary_key, row);
    });
  }

  function captureSnapshot(actor, snapshotPeriod, { scheduled = false } = {}) {
    const b = binding("MonthlySnapshot");
    need(actor, b, "create");
    if (!snapshotPeriodValid(snapshotPeriod)) throw new HttpError(400, "Snapshot period must be YYYY-MM");
    // Capture source from backend; NEVER trust a browser-supplied Pipeline list.
    const source = rows("opportunities").filter((row) => !isSoftDeleted(row));
    const stamp = now();
    // Resolve AE employee code/name on the server and freeze them in the capture.
    // Never let a browser-supplied lookup or current export alter prior snapshots.
    const snapshotUsers = new Map(rows("users").map((user) => [String(user.user_id), user]));
    const snapshots = buildSnapshotRows(source, snapshotPeriod, stamp, () => "SNP-" + uuid(), snapshotUsers);
    if (!snapshots.length) throw new HttpError(409, "No eligible Pipelines; existing snapshot period was preserved");
    const table = tableOf(b);
    // A duplicate manual capture is an expected business conflict, not a
    // server crash; return 409 before any sheet or audit mutation.
    if (table.rows.some((r) => String(r.snapshot_period) === snapshotPeriod)) {
      throw new HttpError(409, "Snapshot period already captured; history is immutable");
    }
    const replacement = replaceSnapshotPeriod(table.rows, snapshotPeriod, snapshots);
    // Validate and build the entire new state before touching the underlying sheet.
    table.rows = replacement;
    touch(b);
    if (scheduled) outputs.logScheduledSnapshot(snapshotPeriod, snapshots.length);
    return { captured: snapshots.length, snapshot_period: snapshotPeriod };
  }

  // Server-internal method only; never expose a request flag that could forge system identity.
  function captureScheduledSnapshot(snapshotPeriod) {
    const scheduledPrincipal = {role:"admin", id:"SYSTEM_MONTH_END", real:{id:"SYSTEM_MONTH_END", name:"Scheduled Snapshot", role:"system"}};
    return captureSnapshot(scheduledPrincipal, snapshotPeriod, {scheduled:true});
  }

  // The Config Sheet is authoritative for active import Customer Types.
  // Preserve old legacy types as distinct values: do not silently reclassify them.
  // This is read-only and is never exposed through the general Source Sheets editor.
  function importCustomerTypes() {
    const legacy = ["Government", "Enterprise", "Industrial", "SME", "Education", "Telco", "Other"];
    const config = store.table("B2B_GEO_Pipeline_Config.xlsx", "Field_Options");
    const active = (config?.rows || [])
      .filter((r) => String(r.field_key || "").trim() === "customer_type" && isActive(r.active))
      .map((r) => String(r.option_value || "").trim()).filter(Boolean);
    return [...new Set([...legacy, ...active])];
  }

  // The only selectable / writable channel values come from active Config > Field_Options.
  // Do not allow an unavailable/misconfigured master to silently use hard-coded options.
  function activeSalesChannelOptions() {
    const config = store.table("B2B_GEO_Pipeline_Config.xlsx", "Field_Options");
    const matching = (config?.rows || [])
      .filter(r => String(r.field_key || "").trim() === "sales_channel" && isActive(r.active))
      .sort((a, b) => Number(a.sort_order || 9999) - Number(b.sort_order || 9999));
    const seen = new Set();
    const options = matching.map(r => {
      const value = String(r.option_value || "").trim();
      const label = String(r.option_label || "").trim() || value;
      if (!value || seen.has(value)) {
        throw new HttpError(503, "Sales Channel Config contains an empty or duplicate active option");
      }
      seen.add(value);
      return { value, label };
    });
    if (!options.length) throw new HttpError(503, "No active Sales Channel options in Pipeline Config");
    return options;
  }

  // CCP+ labels come from Config > Field_Options; inactive "pending" is legacy only.
  function activeCcpCheckOptions() {
    const config = store.table("B2B_GEO_Pipeline_Config.xlsx", "Field_Options");
    const matching = (config?.rows || [])
      .filter(row => String(row.field_key || "").trim() === "ccp_check_result" && isActive(row.active))
      .sort((a, b) => Number(a.sort_order || 9999) - Number(b.sort_order || 9999));
    const seen = new Set();
    const options = matching.map(row => {
      const value = String(row.option_value || "").trim();
      const label = String(row.option_label || "").trim();
      if (!value || !label || seen.has(value)) {
        throw new HttpError(503, "CCP+ Field_Options has missing or duplicate active values");
      }
      seen.add(value);
      return { value, label };
    });
    if (!options.length) throw new HttpError(503, "CCP+ has no active Field_Options");
    return options;
  }


  // The six approved historical partner groups have no verified AE. They may
  // enter the Review Queue under a real, region-authorized SM only, never a
  // fabricated AE owner. This does not waive other import/financial checks.
  const PENDING_AE_PARTNER_GROUPS = new Set([
    "บีทีโฟน", "ร้าน อั่งเปาโฟน", "ลดารัตน์ กุลพิสิทธิเจริญ",
    "มณฑล รักศิริกิจ", "บริษัท บลูไวโอเล็ต จำกัด", "บริษัท 8 ริ้ว สมาร์ท จำกัด",
  ]);

  // User explicitly approved these eleven historical Source IDs on 2026-11-01.
  // New approvals are source-record-specific: no name-based blanket exemption.
  const ADDITIONAL_PENDING_AE_CASES = new Map([
    ["DOC-79e97612cde3acfee14cfb26a78e0ddd-R8", { name: "บริษัท มายเซ็นเตอร์ จำกัด", region: "E", handler: "U0033" }],
    ["DOC-79e97612cde3acfee14cfb26a78e0ddd-R19", { name: "หจก.โฟล์ อิน ซัพพลาย", region: "E", handler: "U0033" }],
    ["DOC-79e97612cde3acfee14cfb26a78e0ddd-R20", { name: "น.ส.วรรณภา ฟ้าประทานชัย", region: "E", handler: "U0033" }],
    ["DOC-79e97612cde3acfee14cfb26a78e0ddd-R22", { name: "บริษัท พีเอฟดี เทค จำกัด", region: "E", handler: "U0033" }],
    ["DOC-79e97612cde3acfee14cfb26a78e0ddd-R23", { name: "บริษัท มายเซ็นเตอร์ จำกัด", region: "E", handler: "U0033" }],
    ["DOC-79e97612cde3acfee14cfb26a78e0ddd-R87", { name: "นางสาวทิพย์วรรณ เกาะทอง", region: "CW", handler: "U0030" }],
    ["DOC-79e97612cde3acfee14cfb26a78e0ddd-R92", { name: "พรพิมล วชิรมิตร", region: "CW", handler: "U0030" }],
    ["DOC-79e97612cde3acfee14cfb26a78e0ddd-R220", { name: "พีพี บริการ", region: "NE1", handler: "U0029" }],
    ["DOC-79e97612cde3acfee14cfb26a78e0ddd-R221", { name: "พีพี บริการ", region: "NE1", handler: "U0029" }],
    ["DOC-79e97612cde3acfee14cfb26a78e0ddd-R222", { name: "พีพี บริการ", region: "NE1", handler: "U0029" }],
    ["DOC-79e97612cde3acfee14cfb26a78e0ddd-R234", { name: "น.ส.กิ่งทอง มะโนวรรณ์", region: "NE2", handler: "U0029" }],
  ]);

  function validatePendingPartnerAssignment(item, actor) {
    if (item.pending_ae_assignment !== true) return false;
    const sourceSaleName = String(item.source_sale_name || "").trim();
    const originalId=String(item.source_legacy_record_id||item.source_record_id||"").trim();
    const extra = ADDITIONAL_PENDING_AE_CASES.get(originalId);
    const isApprovedExistingGroup = PENDING_AE_PARTNER_GROUPS.has(sourceSaleName);
    const reviewed = store.table("B2B_GEO_Pipeline_DB.xlsx","Partner_SM_Review_20261101").rows.find(r =>
      String(r["Source Record ID"] || "").trim() === originalId &&
      String(r["Partner Name"] || "").trim() === sourceSaleName &&
      String(r["Temporary SM User ID"] || "").trim() === String(item.current_handler_id || "").trim() &&
      String(r["Region"] || "").trim() === (rows("regions").find(x =>
        x.region_id === String(item.region_id || ""))?.region_name || "") &&
      String(r["Assignment Status"] || "").trim() === "SM_REVIEW_PENDING_AE");
    if ((!isApprovedExistingGroup || !reviewed) && !extra)
      throw new HttpError(400, "Pending AE assignment requires the approved exact source row and SM review record");
    if (extra && (sourceSaleName !== extra.name ||
        String(item.region_id || "") !== extra.region ||
        String(item.current_handler_id || "") !== extra.handler))
      throw new HttpError(400, "Pending AE assignment does not match approved Source, Region and SM");
    if (!["Premium Partner", "Retail Partner"].includes(normalizeSalesChannel(item.sales_channel)))
      throw new HttpError(400, "Pending AE assignment requires a verified Partner sales channel");
    if (String(item.owner_id || "").trim())
      throw new HttpError(400, "Pending AE assignment must leave AE Owner blank");
    if (!String(item.source_record_id || "").trim() || !String(item.region_id || "").trim())
      throw new HttpError(400, "Pending AE assignment requires source identity and Region");
    const handler = findUser(item.current_handler_id);
    if (!handler || handler.role !== "sm" ||
        !handler.region_ids.includes(String(item.region_id)))
      throw new HttpError(400, "Pending AE assignment requires an authorized regional SM handler");
    if (actor.role !== "admin" && !actor.region_ids.includes(String(item.region_id)))
      throw new HttpError(403, "Pending AE assignment is outside your SM Region");
    const sourceCode = String(item.source_sales_code || "").trim();
    if (sourceCode && rows("users").some(u => String(u.employee_id || "").trim() === sourceCode &&
        normalizeRole(u.role) === "ae" && String(u.status || "Active").toLowerCase() === "active"))
      throw new HttpError(400, "An active AE Employee ID must not be treated as a Partner code");
    return true;
  }

  // The live approval sheet is authoritative for historical source rows. It is
  // accessed only by authenticated import/preview and is NEVER edited here.
  const HISTORICAL_APPROVAL_PREFIX = "DOC-79e97612cde3acfee14cfb26a78e0ddd-R";
  function approvalCasesFor(item) {
    const id = String(item.source_legacy_record_id || item.source_record_id || "").trim();
    if (!id.startsWith(HISTORICAL_APPROVAL_PREFIX)) return [];
    const rowNumber = id.slice(HISTORICAL_APPROVAL_PREFIX.length);
    if (!/^[1-9]\d*$/.test(rowNumber)) return [];
    const candidates = store.table("B2B_GEO_Pipeline_DB.xlsx", "AE_Owner_Approval_20261027").rows;
    const regionName = rows("regions").find(r => r.region_id === String(item.region_id || ""))?.region_name || "";
    return candidates.filter(r => {
      const rowNumbers = String(r["Source Row Numbers"] || "").split(/[,\s]+/).filter(Boolean);
      return rowNumbers.includes(rowNumber) &&
        String(r["Source Region"] || "").trim() === regionName;
    });
  }
  function verifiedApprovedOwner(item, actor) {
    const cases = approvalCasesFor(item);
    // Reject a source-row identity which belongs to an existing approval case
    // but is mislabeled with another Region. Never bypass via Employee ID.
    const rawId=String(item.source_legacy_record_id||item.source_record_id||"").trim();
    if(rawId.startsWith(HISTORICAL_APPROVAL_PREFIX)){
      const suffix=rawId.slice(HISTORICAL_APPROVAL_PREFIX.length);
      const anyRow=store.table("B2B_GEO_Pipeline_DB.xlsx","AE_Owner_Approval_20261027").rows
        .some(r=>String(r["Source Row Numbers"]||"").split(/[,\s]+/).includes(suffix));
      if(anyRow&&!cases.length)throw new HttpError(409,"Approval Source Row / Region mismatch");
    }
    if (!cases.length) return null;
    const approved = cases.filter(c => String(c.Decision || "").trim().toLowerCase() === "approved" &&
      String(c["Approved AE User ID"] || "").trim());
    const ids = new Set(approved.map(c => String(c["Approved AE User ID"]).trim()));
    if (ids.size !== 1) throw new HttpError(409, "Historical AE approval is pending or conflicting for this source row");
    const approvedId = [...ids][0];
    if (item.owner_id && String(item.owner_id) !== approvedId)
      throw new HttpError(409, "Selected AE differs from the approved source-row mapping");
    const ae = findUser(approvedId);
    if (!ae || ae.role !== "ae") throw new HttpError(409, "Approved AE is not an active AE");
    if (item.region_id && !ae.region_ids.includes(String(item.region_id)))
      throw new HttpError(409, "Approved AE is not assigned to the source Region");
    if (actor.role !== "admin" && (!item.region_id || !actor.region_ids.includes(String(item.region_id))))
      throw new HttpError(403, "Source row is outside importer Region");
    const approvedSourceCodes = new Set(approved.map(c => String(c["Source Sales Code"] ?? "").trim()));
    if (approvedSourceCodes.size > 1)
      throw new HttpError(409, "Source Sales Code differs across approved mapping cases");
    const originalCode = [...approvedSourceCodes][0] || "";
    if (String(item.source_original_sales_code ?? "").trim() &&
        String(item.source_original_sales_code).trim() !== originalCode)
      throw new HttpError(409, "Original Sales Code does not match approved source evidence");
    return { ownerId: approvedId, originalSalesCode: originalCode };
  }
  // Original workbook filename, NOT owner Region, is authoritative.
  function resolveHistoricalRegion(item) {
    const filename=String(item.source_workbook||"").trim();
    if(!filename)return item;
    const authorized=historicalRegionForWorkbook(filename);
    if(!authorized)throw new HttpError(409,"Unrecognized original source workbook");
    const requested=String(item.region_id||"").trim();
    if(requested&&requested!==authorized)
      throw new HttpError(409,"Historical Region conflicts with original source workbook");
    return {...item,region_id:authorized,source_region_raw:item.source_region_raw??requested};
  }

  // Employee-ID resolution is permitted only for a VERIFIED direct match.
  // Never force a historically approved source Sales Code to equal an Employee ID.
  function legacyImportOwner(code, actor) {
    const value = String(code ?? "").trim();
    if (!value || value.length > 40) throw new HttpError(400, "Sales Code must be 1-40 characters");
    const matches = rows("users").filter(r => String(r.employee_id ?? "").trim() === value &&
      normalizeRole(r.role) === "ae" && String(r.status || "Active").toLowerCase() === "active");
    if (matches.length !== 1) throw new HttpError(409, "Sales Code needs an approved AE mapping");
    const ae = findUser(matches[0].user_id);
    if (!ae || (actor.role !== "admin" && !ae.region_ids.some(id => actor.region_ids.includes(id))))
      throw new HttpError(403, "Sales Code outside authorized import scope");
    return ae;
  }
  function resolveLegacyImportOwner(item, actor) {
    if (validatePendingPartnerAssignment(item, actor)) return {
      ...item, owner_id: "", source_original_sales_code:
        String(item.source_original_sales_code ?? item.source_sales_code ?? "")
    };
    const approved = verifiedApprovedOwner(item, actor);
    if (approved) return {
      ...item, owner_id: approved.ownerId,
      current_handler_id: item.current_handler_id || approved.ownerId,
      source_original_sales_code: approved.originalSalesCode
    };
    // An explicitly pending approval must not be bypassed using a coincidental
    // employee-code match or a manually chosen owner.
    if (approvalCasesFor(item).length)
      throw new HttpError(409, "Historical AE mapping has no approved case for this source row");
    const code = String(item.source_sales_code ?? "").trim();
    if (!code) {
      // Backward-compatible import from other authenticated source systems:
      // a selected *existing active AE* is acceptable if it is in scope.
      // The approved Legacy Spreadsheet migration still requires verified evidence.
      if (String(item.source_system || "") === "Legacy Spreadsheet")
        throw new HttpError(409, "Historical Spreadsheet row requires approved AE mapping or verified Employee ID");
      const ae=findUser(item.owner_id);
      if(!ae||ae.role!=="ae"||
         (actor.role!=="admin"&&!ae.region_ids.some(id=>actor.region_ids.includes(id))))
        throw new HttpError(409, "No verified active AE Owner");
      return {...item,current_handler_id:item.current_handler_id||ae.id,
        source_original_sales_code:String(item.source_original_sales_code||"")};
    }
    const ae = legacyImportOwner(code, actor);
    if (item.owner_id && String(item.owner_id) !== ae.id)
      throw new HttpError(400, "Source Employee ID conflicts with selected AE Owner");
    return {
      ...item, owner_id: ae.id,
      current_handler_id: item.current_handler_id || ae.id,
      source_original_sales_code: String(item.source_original_sales_code ?? code)
    };
  }
  function resolveLegacyImportOwners(actor, input) {
    if (!["sm", "admin"].includes(actor.role)) throw new HttpError(403, "Only SM or Admin may resolve source Sales Codes");
    const codes = input?.codes;
    if (!Array.isArray(codes) || codes.length > 200 || codes.some(c => typeof c !== "string"))
      throw new HttpError(400, "Provide up to 200 Sales Codes");
    const unique = [...new Set(codes.map(v => v.trim()).filter(Boolean))];
    return { owners: unique.map(code => {
      try {
        const owner = legacyImportOwner(code, actor);
        return { code, found:true, id:owner.id, name:owner.name, region_ids:owner.region_ids };
      } catch { return { code, found:false, approved_case_required:true }; }
    }) };
  }

  function validateImportEvidence(item, allowedTypes) {
    const status = String(item.status || "open").trim().toLowerCase();
    const stage = String(item.stage_id || "").trim();
    if ((stage === "STG001" || stage === "STG002") && status !== "open")
      throw new HttpError(400, "Historical Stage 1/2 must map to Open");
    if (stage === "STG003" && status !== "won")
      throw new HttpError(400, "Historical Stage 3 must map to Won");
    if (status === "won" && stage !== "STG003")
      throw new HttpError(400, "Historical Won requires Stage 3");
    if (status === "lost" && stage === "STG003")
      throw new HttpError(400, "Historical Cancel must not be changed into Stage 3");
    if (!["open", "won", "lost"].includes(status)) throw new HttpError(400, "Import Status must be Open, Won or Lost");
    const fields = ["source_created_at", "source_stage_entered_at", "source_closed_at"];
    const dates = {};
    for (const key of fields) {
      const value = item[key] == null ? "" : String(item[key]).trim();
      const normalized=normalizeHistoricalDate(value);
      const valid=normalized===null?null:validImportDate(normalized);
      if (valid === null) throw new HttpError(400, key + " must be a real YYYY-MM-DD date (no guessed locale dates)");
      dates[key] = valid;
    }
    const historicalMonth=normalizeHistoricalMonth(item.source_created_month);
    if (historicalMonth === null || (historicalMonth && (!isMonthKey(historicalMonth) || Number(historicalMonth.slice(0, 4)) < 1900 ||
        Number(historicalMonth.slice(0, 4)) > 2100))) throw new HttpError(400, "Invalid source_created_month");
    if (historicalMonth && dates.source_created_at && historicalMonth !== dates.source_created_at.slice(0, 7))
      throw new HttpError(400, "Source Created Date does not match Create Month");
    if (dates.source_created_at && dates.source_stage_entered_at &&
        dates.source_stage_entered_at < dates.source_created_at)
      throw new HttpError(400, "Stage Entered Date cannot precede Created Date");
    if (status !== "open") {
      if (!dates.source_closed_at && !approvedUndatedHistoricalCancel({...item,source_record_id:item.source_legacy_record_id||item.source_record_id}) &&
          !approvedHistoricalStage3({...item,source_record_id:item.source_legacy_record_id||item.source_record_id}))
        throw new HttpError(400, "Historical Won/Lost requires an original Closed Date unless explicitly approved historical Cancel or Stage 3 service opening");
      if (dates.source_closed_at && dates.source_created_at && dates.source_closed_at < dates.source_created_at)
        throw new HttpError(400, "Closed Date cannot precede Created Date");
      if (dates.source_closed_at && dates.source_stage_entered_at && dates.source_closed_at < dates.source_stage_entered_at)
        throw new HttpError(400, "Closed Date cannot precede Stage Entered Date");
      if (status === "lost") {
        const id = String(item.lost_reason_id || "").trim();
        if (!id || !rows("lost_reasons").some((r) => r.reason_id === id && isActive(r.active)))
          throw new HttpError(400, "Historical Lost requires an active Lost Reason");
      }
    } else if (dates.source_closed_at) {
      throw new HttpError(400, "Open Pipelines cannot contain a historical Closed Date");
    }
    const requestedType = /^others$/i.test(String(item.customer_type || "").trim()) ? "Other" : String(item.customer_type || "").trim();
    const normalizedCustomerType = allowedTypes.find((type) => type.toLowerCase() === requestedType.toLowerCase());
    if (item.customer_type && !normalizedCustomerType)
      throw new HttpError(400, "Unknown Customer Type. Use an existing legacy type or active Field_Options value");
    if (String(item.business_id ?? "").length > 40)
      throw new HttpError(400, "Historical Business ID exceeds 40 characters");
    // Original Sales Code is evidence, not an Employee ID constraint.
    // The approved owner was independently resolved against the live AE approval sheet.
    const originalCode = String(item.source_original_sales_code ?? item.source_sales_code ?? "");
    if (originalCode.length > 40) throw new HttpError(400, "Original Sales Code exceeds 40 characters");
    for (const key of ["source_record_id", "source_system", "source_customer_type", "source_sales_code", "source_sale_name", "source_product_id", "source_rc",
                       "source_discount_pct", "source_monthly_sale_plan"]) {
      if (String(item[key] ?? "").length > 160) throw new HttpError(400, key + " exceeds 160 characters");
    }
    // Historical source values are evidence, not a request to reprice the deal.
    // Unknown/ambiguous figures remain empty in numeric Pipeline fields, and
    // the raw text stays in provenance for reconciliation and later SM review.
    const sourceNetRc = String(item.reference_net_rc ?? "").trim();
    if (sourceNetRc.length > 160) throw new HttpError(400, "Reference Net RC exceeds 160 characters");
    const sourceNetNumber = sourceNetRc.replace(/,/g, "");
    const numericNetRc = sourceNetRc && /^\d+(?:\.\d{1,2})?$/.test(sourceNetNumber)
      && Number.isFinite(Number(sourceNetNumber)) ? Number(sourceNetNumber) : null;
    const sourceQuantity = item.source_subs === undefined ? item.quantity : item.source_subs;
    const validQuantity = sourceQuantity !== "" && sourceQuantity != null &&
      Number.isSafeInteger(Number(sourceQuantity)) && Number(sourceQuantity) > 0;
    const originalOc = String(item.source_oc ?? item.oc ?? "").trim();
    const validOc=originalOc.replace(/,/g,"");
    const numericOc=originalOc && /^\d+(?:\.\d{1,2})?$/.test(validOc) &&
      Number.isFinite(Number(validOc)) ? Number(validOc) : null;
    return {
      normalizedCustomerType,
      status: status.charAt(0).toUpperCase() + status.slice(1),
      sourceCreatedAt: dates.source_created_at,
      sourceStageEnteredAt: dates.source_stage_entered_at,
      sourceClosedAt: dates.source_closed_at,
      createdMonth: historicalMonth || (dates.source_created_at ? dates.source_created_at.slice(0, 7) : ""),
      sourceRecordId: String(item.source_record_id || "").trim(),
      sourceLegacyRecordId:String(item.source_legacy_record_id || ""),
      sourceRow:String(item.source_row ?? ""),
      sourceSystem: String(item.source_system || "").trim(),
      sourceProductId: String(item.source_product_id || "").trim(),
      sourceCustomerType: String(item.source_customer_type || item.customer_type || "").trim(),
      sourceRc: String(item.source_rc ?? "").trim(),
      sourceDiscountPct: String(item.source_discount_pct ?? "").trim(),
      sourceMonthlySalePlan: String(item.source_monthly_sale_plan ?? "").trim(),
      sourceNetRc,
      numericNetRc,
      historicalQuantity: validQuantity ? Number(sourceQuantity) : null,
      numericOc,
      originalSalesCode:String(item.source_original_sales_code ?? item.source_sales_code ?? ""),
      originalSubs:String(sourceQuantity ?? ""),
      originalOc,
      originalBusinessId:String(item.source_business_id ?? item.business_id ?? ""),
      originalChannel:String(item.source_sales_channel_raw ?? ""),
      originalRegion:String(item.source_region_raw ?? ""),
      originalStage:String(item.source_stage_raw ?? ""),
      sourceWorkbook:String(item.source_workbook ?? ""),
      originalCreatedDate:String(item.source_created_at_raw ?? item.source_created_at ?? ""),
      originalCreatedMonth:String(item.source_created_month_raw ?? item.source_created_month ?? ""),
      originalClosedDate:String(item.source_closed_at_raw ?? item.source_closed_at ?? ""),
      originalStageEnteredDate:String(item.source_stage_entered_at_raw ?? item.source_stage_entered_at ?? ""),
      approvedHistoricalStage3: stage === "STG003" && status === "won" &&
        !!String(item.source_system || "").trim() && !!String(item.source_record_id || "").trim(),
      pendingPartnerAe: item.pending_ae_assignment === true,
      lostReasonId: status === "lost" ? String(item.lost_reason_id || "").trim() : "",
    };
  }

  // Preserve fingerprints from earlier deployments ONLY for replaying old batches.
  const importCommercialFingerprint = (item) => JSON.stringify([
    "business_id","product_category_id","expected_close_month","owner_id",
    "product_details","contact_phone","quantity","price_per_sub","oc"
  ].map((key) => String(item[key] ?? "").trim().toLowerCase()));
  const oldImportFingerprint = (item) => JSON.stringify([
    importCommercialFingerprint(item), String(item.source_created_month ?? "").trim()
  ]);
  // v2 includes ALL mapped source fields, not commercial similarity. A stable
  // source-system + source-record ID is the only cross-batch duplicate key.
  const importFingerprint = (item) => "v2:" + JSON.stringify(
    Object.keys(item).filter((key) => key !== "client_request_id").sort()
      .map((key) => [key, String(item[key] ?? "").trim()])
  );
  const sourceKey = (system, id) => String(id || "").trim()
    ? JSON.stringify([String(system || "").trim().toLowerCase(), String(id).trim().toLowerCase()])
    : "";

  // One immutable Excel source row is one Opportunity. Business ID, customer name,
  // product and stage similarity are NOT duplicate keys.
  function validateImportEnvelope(actor, input, requireBatchId) {
    const b = binding("Opportunity");
    need(actor,b,"import");
    need(actor,b,"create");
    if (!["sm","admin"].includes(actor.role)) throw new HttpError(403,"Only SM or Admin may import Pipelines");
    const items=input?.items;
    if(!Array.isArray(items)||items.length<1||items.length>200||
       items.some(i=>!i||typeof i!=="object"||Array.isArray(i)))
      throw new HttpError(400,"Historical import requires 1-200 source rows");
    const batchId=String(input?.batch_id||"");
    if((requireBatchId||batchId) && !/^[A-Za-z0-9_-]{16,80}$/.test(batchId))
      throw new HttpError(400,"Invalid import_batch_id");
    return {binding:b,items,batchId};
  }
  const REQUIRED_HISTORICAL_EVIDENCE_HEADERS=[
    "import_source_sales_code","import_source_subs","import_source_oc",
    "import_source_business_id","import_source_sales_channel","import_source_region",
    "import_source_stage","import_source_workbook",
    "import_source_created_at_raw","import_source_created_month_raw",
    "import_source_closed_at_raw","import_source_stage_entered_at_raw",
    "import_source_legacy_record_id","import_source_row"
  ];
  function inspectImportBatch(actor,input,requireBatchId=false) {
    const {binding:b,items,batchId}=validateImportEnvelope(actor,input,requireBatchId);
    const missingHeaders=REQUIRED_HISTORICAL_EVIDENCE_HEADERS.filter(h=>!tableOf(b).headers.includes(h));
    const known=new Map();
    tableOf(b).rows.forEach(r=>{
      const key=sourceKey(r.import_source_system,r.import_source_record_id);
      if(key){
        if(known.has(key))throw new HttpError(503,"Existing Production source key collision; reconcile before import");
        known.set(key,r.opportunity_id);
      }
    });
    const seen=new Set(),allowedTypes=importCustomerTypes();
    const activeChannels=activeSalesChannelOptions().map(o=>o.value);
    const prepared=[];
    const results=items.map((raw,index)=>{
      let normalized;
      try { normalized=originalSourceIdentity(raw); }
      catch(err){ return {row:index+1,status:"HOLD",source_system:String(raw.source_system||""),
        source_record_id:String(raw.source_record_id||""),validation_errors:[err.message],financial_warnings:[]}; }
      const system=String(normalized.source_system??"").trim();
      const recordId=String(normalized.source_record_id??"").trim();
      const key=sourceKey(system,recordId);
      const result={row:index+1,source_system:system,source_record_id:recordId,
        status:"HOLD",validation_errors:[],financial_warnings:[]};
      if(!system||!recordId||
         (system==="Legacy Spreadsheet" &&
          !(/^(?:DOC-[a-f0-9]{32}-R[1-9]\d*|ROW\|PIPELINE [A-Z0-9 -]+\|Pipeline\|(?:[2-9]|[1-9]\d+))$/i.test(recordId)))){
        result.validation_errors.push("Stable Source System + Source File/Original Row ID are required");
        return result;
      }
      if(system==="Legacy Spreadsheet"&&missingHeaders.length){
        result.validation_errors.push("Import source-evidence columns not prepared: "+missingHeaders.join(", "));
        result.validation_error_status=503;
        return result;
      }
      if(seen.has(key)){
        result.status="POTENTIAL_DUPLICATE";
        result.validation_errors.push("Duplicate technical source key within this batch; use distinct original source rows");
        return result;
      }
      seen.add(key);
      if(known.has(key)){
        result.status="ALREADY_IMPORTED";
        result.opportunity_id=known.get(key);
        return result;
      }
      // Legacy aliases may collide across distinct Excel rows. Only a
      // separately reviewed Production ID can prove a prior import for this row.
      const legacyKey=normalized.source_legacy_record_id
        ? sourceKey(system,normalized.source_legacy_record_id) : "";
      if(legacyKey&&known.has(legacyKey)){
        const confirmed=String(raw.matched_production_opportunity_id||"").trim();
        const existing=String(known.get(legacyKey));
        if(confirmed&&confirmed===existing){
          result.status="ALREADY_IMPORTED";result.opportunity_id=existing;return result;
        }
        result.status="POTENTIAL_DUPLICATE";
        result.validation_errors.push("Legacy Source ID matches Production but exact original row lacks verified Production identity");
        return result;
      }
      if(raw.matched_production_opportunity_id){
        result.status="HOLD";
        result.validation_errors.push("Reviewed matched Production ID has no matching existing technical source key");
        return result;
      }
      try{
        const item=resolveLegacyImportOwner(resolveHistoricalRegion(normalized),actor);
        const evidence=validateImportEvidence(item,allowedTypes);
        const mappedType=evidence.normalizedCustomerType||item.customer_type;
        const mappedChannel=normalizeSalesChannel(item.sales_channel)||item.sales_channel;
        validateLatestOpportunityFields({...item,customer_type:mappedType,sales_channel:mappedChannel},
          {requireRequired:true,additionalCustomerTypes:allowedTypes,allowedSalesChannels:activeChannels,legacyImport:true});
        const row=toSheet("Opportunity","opportunity_id",namesToIds("Opportunity",
          {...item,customer_type:mappedType,sales_channel:mappedChannel}));
        row.import_batch_id=batchId||"PREVIEW_READ_ONLY";
        row.status=evidence.status;
        row.current_handler_user_id=row.current_handler_user_id||row.owner_user_id;
        validateOpportunityRefs(row,null,actor,{
          allowPendingPartnerAe:evidence.pendingPartnerAe,
          allowApprovedHistoricalStage3:evidence.approvedHistoricalStage3,
          allowUnknownHistoricalRegion:true
        });
        validateCollaborators(row,row.region_id);
        if(!scopedFilter(b,actor)(row))
          throw new HttpError(403,"Historical Pipeline is outside your authorized Region");
        if(evidence.historicalQuantity===null)
          result.financial_warnings.push("SUBS_UNKNOWN");
        if(evidence.numericNetRc===null)
          result.financial_warnings.push("NET_RC_UNKNOWN");
        if(String(item.source_rc??"").trim()==="")
          result.financial_warnings.push("RC_UNKNOWN");
        if(evidence.numericOc===null)
          result.financial_warnings.push("OC_UNKNOWN_OR_NONNUMERIC");
        result.status="READY";
        prepared[index]={item,evidence};
      }catch(error){
        result.validation_errors.push(String(error.message||"Unknown import validation error"));
        result.validation_error_status=error.status||400;
      }
      return result;
    });
    const summary={READY:0,ALREADY_IMPORTED:0,HOLD:0,POTENTIAL_DUPLICATE:0};
    results.forEach(r=>{summary[r.status]++});
    return {total:items.length,summary,results,prepared};
  }
  function previewImportOpportunities(actor,input) {
    const inspected=inspectImportBatch(actor,input,false);
    // This function never calls touch(), creates Events, writes Audit, or flushes.
    return {read_only:true,total:inspected.total,summary:inspected.summary,results:inspected.results};
  }
  function importOpportunities(actor,input) {
    const inspected=inspectImportBatch(actor,input,true);
    const {binding:b,items,batchId}=validateImportEnvelope(actor,input,true);
    if(inspected.summary.POTENTIAL_DUPLICATE)
      throw new HttpError(409,"Multiple original Excel rows share a technical Source ID in this batch");
    if(inspected.summary.HOLD){
      const first=inspected.results.find(r=>r.status==="HOLD");
      throw new HttpError(first.validation_error_status||400,
        "Historical import row "+first.row+": "+first.validation_errors.join("; "));
    }
    const existingBatch=tableOf(b).rows.filter(r=>String(r.import_batch_id||"")===batchId);
    const signatures=items.map(importFingerprint);
    const sourceIdentities=items.map(i=>originalSourceIdentity(i));
    // A batch ID may safely be retried only with identical row signatures.
    existingBatch.forEach(r=>{
      const i=Number(r.import_row_number)-1;
      if(!Number.isInteger(i)||i<0||i>=items.length||
        ![signatures[i],oldImportFingerprint(items[i]),importCommercialFingerprint(items[i])]
          .includes(String(r.import_row_signature||"")) ||
        sourceKey(r.import_source_system,r.import_source_record_id)!==
          sourceKey(sourceIdentities[i].source_system,sourceIdentities[i].source_record_id))
        throw new HttpError(409,"Import Batch ID already used for different source rows");
    });
    if(!inspected.summary.READY)
      return {imported:0,skipped:inspected.summary.ALREADY_IMPORTED,failed:0,
        already_imported:true,total:items.length,results:inspected.results,
        opportunity_ids:inspected.results.map(r=>r.opportunity_id).filter(Boolean)};
    // Every READY row passed the same evidence/ref checks as commit. No preflight
    // operation touched the canonical Pipeline/Event/Audit data.
    const transactionSheets=["Pipelines","Pipeline_Events","Handoff_Notifications"];
    const backups=transactionSheets.filter(name=>
      !!contract.access.files["B2B_GEO_Pipeline_DB.xlsx"]?.sheets?.[name])
      .map(name=>{
        const t=store.table("B2B_GEO_Pipeline_DB.xlsx",name);
        return {name,t,rows:t.rows.slice(),headers:t.headers.slice()};
      });
    try{
      const results=inspected.results.map((status,index)=>{
        if(status.status!=="READY")return status;
        const p=inspected.prepared[index];
        const created=entityApi.create("Opportunity",actor,p.item,{
          batchId,rowNumber:index+1,signature:signatures[index],
          ...p.evidence,allowedTypes:importCustomerTypes()
        });
        return {...status,opportunity_id:created.id,status:"IMPORTED"};
      });
      return {imported:results.filter(r=>r.status==="IMPORTED").length,
        skipped:results.filter(r=>r.status==="ALREADY_IMPORTED").length,
        failed:0,already_imported:false,total:items.length,results,
        opportunity_ids:results.filter(r=>r.status==="IMPORTED").map(r=>r.opportunity_id)};
    }catch(error){
      backups.forEach(backup=>{
        backup.t.rows=backup.rows;
        backup.t.headers=backup.headers;
        // Clearing any dirtied tables before returning the exception is essential:
        // the outer GAS transaction must never flush a failed batch's scratch rows.
      });
      // The outer request throws and must never call flush(). The original
      // tables are restored in memory; pre-existing commit logic handles errors.
      for(const backup of backups)store.touch("B2B_GEO_Pipeline_DB.xlsx",backup.name);
      throw error;
    }
  }

  // Scenario Tasks are templates; Pipeline_Tasks holds actual progress. Both
  // are owned by these routes, never by the generic source-sheet editor.
  function taskRows(actor, opportunityId) {
    const opportunityBinding = binding("Opportunity");
    need(actor, opportunityBinding, "read");
    const allowed = scopedFilter(opportunityBinding, actor);
    let opportunities = tableOf(opportunityBinding).rows.filter(allowed).filter(o => !isSoftDeleted(o));
    if (opportunityId) {
      opportunities = opportunities.filter(o => o.opportunity_id === opportunityId);
      if (!opportunities.length) throw new HttpError(404, "Pipeline not found or outside access scope");
    }
    const templates = rows("scenario_tasks");
    const instances = rows("pipeline_tasks");
    for (const template of templates.filter(t => /^(yes|true|1)$/i.test(String(t.active || "")))) {
      if (!["calendar","business"].includes(String(template.day_type)) ||
          !["stage_entry","manual","after_previous"].includes(String(template.start_policy)) ||
          (template.sla_days !== "" && template.sla_days != null && validDays(template.sla_days) === null) ||
          !String(template.task_id || "").trim() || !String(template.task_name || "").trim()) {
        throw new HttpError(503, "Active Scenario Task Config is invalid. Ask Admin to check Scenario_Tasks.");
      }
    }
    return opportunities.flatMap(o => pipelineTaskViews(o, templates, instances, now()));
  }
  function saveTaskProgress(actor, opportunityId, taskId, input = {}) {
    const opportunityBinding = binding("Opportunity");
    need(actor, opportunityBinding, "update");
    const opportunity = tableOf(opportunityBinding).rows.find(o => o.opportunity_id === opportunityId);
    if (!opportunity || !scopedFilter(opportunityBinding, actor)(opportunity))
      throw new HttpError(404, "Pipeline not found or outside access scope");
    if (isSoftDeleted(opportunity))
      throw new HttpError(409, "Restore Pipeline before updating Tasks");
    if (isSoftDeleted(opportunity))
      throw new HttpError(409, "Restore Pipeline before updating Tasks");
    if (String(opportunity.status).toLowerCase() !== "open")
      throw new HttpError(409, "Only Open Pipelines may update tasks");
    const item = taskRows(actor, opportunityId).find(t => t.task_id === taskId);
    if (!item) throw new HttpError(404, "Task is not configured for this Scenario and Stage");
    const status = String(input.status || "");
    if (!["in_progress","done"].includes(status)) throw new HttpError(400, "Invalid task status");
    if (item.status === "done") throw new HttpError(409, "Completed Task is locked");
    if (status === item.status) return item;
    if (item.status === "not_started" && item.start_policy === "after_previous" && !item.started_at)
      throw new HttpError(409, "Previous task must be completed before this task starts");
    if (typeof input.expected_updated_at !== "string" || input.expected_updated_at !== item.updated_at)
      throw new HttpError(409, "Task changed; refresh before saving");
    const binding = bindings.pipeline_tasks;
    if (!binding) throw new HttpError(503, "Pipeline_Tasks is not configured");
    const table = tableOf(binding);
    const stamp = now();
    let record = table.rows.find(r => r.opportunity_id === opportunityId &&
      r.task_id === taskId && r.stage_entered_at === item.stage_entered_at &&
      r.scenario_id === item.scenario_id && r.stage_id === item.stage_id);
    if (!record) {
      record = { task_instance_id:"TSK-" + uuid(), opportunity_id:opportunityId,
        task_id:taskId, scenario_id:item.scenario_id, stage_id:item.stage_id,
        stage_entered_at:item.stage_entered_at, status:"not_started",
        started_at:"", completed_at:"", updated_at:"", updated_by_user_id:"", note:"" };
      table.rows.push(record);
    }
    record.started_at = item.started_at || stamp;
    record.status = status;
    record.completed_at = status === "done" ? stamp : "";
    record.updated_at = stamp;
    record.updated_by_user_id = actor.real.id;
    touch(binding);
    appendAudit(opportunityId, [{
      event_type: status === "done" ? "TASK_COMPLETED" : "TASK_STARTED",
      field_name: "task_id", previous_value: item.status,
      new_value: status, remark: taskId,
    }], actor, stamp);
    return taskRows(actor, opportunityId).find(t => t.task_id === taskId);
  }

  // All notification/support APIs use the signed actor from the server.
  // Never expose these app-owned tables via generic entity or raw Sheet APIs.
  const notificationBinding = bindings.handoff_notifications;
  const notificationRows = () => notificationBinding ? tableOf(notificationBinding).rows : [];
  const parseIds = (value) => String(value || "").split(",").map((id) => id.trim()).filter(Boolean);
  function validateCollaborators(changes, currentRegion) {
    if ("working_with_team_ids" in changes) {
      const teamIds = parseIds(changes.working_with_team_ids);
      if (teamIds.length > 8 || new Set(teamIds).size !== teamIds.length)
        throw new HttpError(400, "Select up to 8 distinct Working With teams");
      for (const id of teamIds) {
        const team = rows("working_with_options").find((t) => t.team_id === id && isActive(t.active));
        if (!team) throw new HttpError(400, "Unknown or inactive Working With team");
      }
      changes.working_with_team_ids = teamIds.join(",");
      // Keep the legacy single-team field for existing dashboard indicators.
      changes.working_with_id = teamIds[0] || "";
    }
    if ("working_with_user_ids" in changes) {
      const userIds = parseIds(changes.working_with_user_ids);
      if (userIds.length > 12 || new Set(userIds).size !== userIds.length)
        throw new HttpError(400, "Select up to 12 distinct Working With people");
      for (const id of userIds) {
        const user = findUser(id);
        if (!user || (!["admin","management"].includes(user.role) &&
            !user.region_ids.includes(String(currentRegion))))
          throw new HttpError(400, "Working With person must be active and assigned to the selected Region");
      }
      changes.working_with_user_ids = userIds.join(",");
    }
  }
  // This is a data-completeness rule, not another Pipeline status or handoff.
  // Only SM is responsible for completing both fields; Pending CCP+ is incomplete.
  function needsSmInput(op) {
    return !String(op.scenario_id || "").trim() ||
      !String(op.ccp_check_result || "").trim() ||
      String(op.ccp_check_result).toLowerCase() === "pending";
  }
  function addCreationNotifications(op, actor, stamp) {
    if (!notificationBinding) return;
    const t = tableOf(notificationBinding);
    const recipients = new Map();
    const ownerId = String(op.owner_user_id || "");
    // When SM/Management creates for an AE, assign the work to that AE
    // without changing the commercial ownership or handler semantics.
    if (["sm", "management", "admin"].includes(actor.role) &&
        ownerId && ownerId !== actor.real.id && findUser(ownerId)) {
      recipients.set(ownerId, "pipeline_assigned");
    }
    if (["ae", "management"].includes(actor.role) && needsSmInput(op)) {
      // Multiple eligible SMs in one Region each receive one notification.
      // No arbitrary "primary SM" is inferred from User_Region.is_primary,
      // which denotes a user's primary Region rather than a Region leader.
      for (const user of rows("users")) {
        if (String(user.role || "").trim().toLowerCase() !== "sm") continue;
        const sm = findUser(user.user_id);
        if (sm && sm.id !== actor.real.id &&
            sm.region_ids.includes(String(op.region_id))) {
          recipients.set(sm.id, "sm_input_needed");
        }
      }
    }
    for (const [recipientId, type] of recipients) {
      t.rows.push({
        notification_id: "NTF-" + uuid(), recipient_user_id: recipientId,
        opportunity_id: op.opportunity_id, actor_user_id: actor.real.id,
        type, created_at: stamp, read_at: "",
      });
    }
    if (recipients.size) touch(notificationBinding);
  }
  function addHandoffNotification(opportunityId, oldHandler, newHandler, actor, stamp) {
    if (!notificationBinding || !newHandler || oldHandler === newHandler || newHandler === actor.real.id) return;
    const recipient = findUser(newHandler);
    if (!recipient) return;
    const t = tableOf(notificationBinding);
    t.rows.push({
      notification_id: "NTF-" + uuid(),
      recipient_user_id: newHandler,
      opportunity_id: opportunityId,
      actor_user_id: actor.real.id,
      type: "handoff",
      created_at: stamp,
      read_at: "",
    });
    touch(notificationBinding);
  }
  function opportunityName(id) {
    const b = binding("Opportunity");
    return tableOf(b).rows.find((o) => o.opportunity_id === id)?.customer_name || "";
  }
  function needsSmInputById(id) {
    const b = binding("Opportunity");
    const op = tableOf(b).rows.find((o) => o.opportunity_id === id);
    return !!op && needsSmInput(op);
  }
  function listNotifications(actor) {
    if (!notificationBinding) throw new HttpError(503, "Handoff Notifications need database setup");
    const opportunityBinding = binding("Opportunity");
    const inScope = scopedFilter(opportunityBinding, actor);
    const opportunityById = new Map(tableOf(opportunityBinding).rows.map(
      (op) => [op.opportunity_id, op]
    ));
    const mine = notificationRows().filter((n) => n.recipient_user_id === actor.real.id);
    const visible = mine.filter((n) => {
      const op = opportunityById.get(n.opportunity_id);
      return !!op && inScope(op) && !isSoftDeleted(op);
    });
    return {
      unread_count: visible.filter((n) => !n.read_at).length,
      items: visible.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 30)
        .map((n) => ({ id:n.notification_id, opportunity_id:n.opportunity_id,
          actor_name:findUser(n.actor_user_id)?.name || "Colleague",
          type:n.type || "handoff",
          customer_name:opportunityById.get(n.opportunity_id)?.customer_name || "",
          needs_sm_input:!!opportunityById.get(n.opportunity_id) &&
            needsSmInput(opportunityById.get(n.opportunity_id)),
          created_at:n.created_at, read_at:n.read_at || "" }))
    };
  }
  function readNotification(actor, id) {
    if (!notificationBinding) throw new HttpError(503, "Handoff Notifications need database setup");
    const item=notificationRows().find((n) => n.notification_id === id &&
      n.recipient_user_id === actor.real.id);
    if (!item) throw new HttpError(404, "Notification not found");
    // Only the recipient, not Admin or the sender, may mark it read.
    if (!item.read_at) { item.read_at = now(); touch(notificationBinding); }
    return { ok:true };
  }
  // Support is a Pipeline flag, not a ticket queue. Historical Support_Requests
  // rows are deliberately left untouched for audit/rollback; no API writes to
  // that retired table. Pipeline support changes use regular update + Events.

  // Retired UAT feature: do not accept new Support writes. Legacy columns,
  // master rows and immutable audit events remain available for history/rollback.
  const RETIRED_SUPPORT_FIELDS = new Set(["support_needed", "support_type", "support_type_id", "support_note"]);
  function rejectRetiredSupportPayload(uiEntity, data) {
    if (uiEntity === "SupportType") throw new HttpError(410, "Support feature has been retired");
    if (uiEntity === "Opportunity" && data && typeof data === "object" &&
        Object.keys(data).some((key) => RETIRED_SUPPORT_FIELDS.has(key))) {
      throw new HttpError(410, "Needs Support has been retired; remove Support fields and retry");
    }
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
  function validateOpportunityRefs(next, prev = null, actor = null, { allowPendingPartnerAe = false, allowApprovedHistoricalStage3 = false, allowUnknownHistoricalRegion = false } = {}) {
    const changed = (col) => !prev || String(prev[col] ?? "") !== String(next[col] ?? "");
    const filled = (col) => String(next[col] ?? "").trim() !== "";
    const refs = [
      ["region_id", "regions", "Region"],
      ["territory_id", "territories", "Territory"],
      ["stage_id", "stages", "Stage"],
      ["product_category_id", "product_categories", "Product Category"],
      ["scenario_id", "scenarios", "Scenario"],
      ["working_with_id", "working_with_options", "Working With"],
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
      // Historical-only exception for approved, source-identifiable Stage 3
      // records; STG003 remains inactive for new Pipelines and ordinary edits.
      const allowLegacyStage = col === "stage_id" && allowApprovedHistoricalStage3 &&
        String(next[col]) === "STG003" && !!master;
      if (!master || (!isActive(master.active) && !allowLegacyStage)) {
        throw new HttpError(400, "Unknown or inactive " + label + ": " + next[col]);
      }
    }
    if (changed("expected_close_month") &&
        ((!filled("expected_close_month") && !String(next.import_batch_id || "").trim()) ||
         (filled("expected_close_month") && !isMonthKey(String(next.expected_close_month))))) {
      throw new HttpError(400, "Expected Close Month must be YYYY-MM");
    }
    if ((changed("territory_id") || changed("region_id")) && filled("territory_id") && bindings.territories) {
      const t = rows("territories").find((r) => String(r.territory_id) === String(next.territory_id));
      if (t && t.region_id !== next.region_id) throw new HttpError(400, "Territory does not belong to the selected Region");
    }
    const regionChanged = changed("region_id");
    if (!filled("region_id")) {
      // The historical import contract explicitly preserves unknown Regions.
      // Such a record can be edited/closed within its existing access scope,
      // but nobody may reassign Owner or Handler until a real Region is set.
      // New Pipelines and attempts to clear a known Region still fail closed.
      const unchangedImportedRegion = !!prev &&
        !!String(next.import_batch_id || "").trim() &&
        !filledPrev(prev, "region_id") && !regionChanged &&
        !changed("owner_user_id") && !changed("current_handler_user_id");
      const authorizedUnknown = !prev && allowUnknownHistoricalRegion &&
        actor?.role === "admin" && String(next.import_batch_id || "").trim();
      if (!unchangedImportedRegion && !authorizedUnknown) throw new HttpError(400,
        "Region is required before assigning an Owner or Handler");
    }
    if (changed("owner_user_id") || regionChanged) {
      // Only a trusted historical import may start without a commercial owner.
      // Its current handler MUST be an active SM in the Pipeline's Region.
      if (!prev && allowPendingPartnerAe && String(next.import_batch_id || "").trim() &&
          !String(next.owner_user_id || "").trim()) {
        const custodian = findUser(next.current_handler_user_id);
        if (!custodian || custodian.role !== "sm" ||
            !custodian.region_ids.includes(String(next.region_id))) {
          throw new HttpError(400, "Unassigned historical Pipeline requires a regional SM custodian");
        }
      } else {
        const owner = findUser(next.owner_user_id);
        if (!owner || owner.role !== "ae") throw new HttpError(400, "Owner must be an active AE");
        if (filled("region_id") && !owner.region_ids.includes(String(next.region_id))) {
          throw new HttpError(400, "Owner AE is not assigned to this Pipeline's Region");
        }
      }
    }
    if (changed("current_handler_user_id") || regionChanged) {
      const handler = findUser(next.current_handler_user_id || next.owner_user_id);
      if (!handler) throw new HttpError(400, "Current Handler must be an active user");
      // Existing escalation workflows may assign Management. AE cannot grant a
      // Management/Admin user customer-row access via an arbitrary handoff.
      if (["management", "admin"].includes(handler.role)) {
        if (actor?.role === "ae") throw new HttpError(403, "AE cannot hand off directly to Management or Admin");
        // Management has nationwide scope by authorized role, independent of
        // User_Region. Admin and Management can receive authorized escalations.
        if (handler.role === "management" && scopeForRole(handler.role) !== "all" &&
            !handler.region_ids.includes(String(next.region_id))) {
          throw new HttpError(400, "Management Handler is not assigned to this Pipeline's Region");
        }
      } else if (!["ae", "sm"].includes(handler.role) || (filled("region_id") && !handler.region_ids.includes(String(next.region_id)))) {
        throw new HttpError(400, "Current Handler AE/SM must be assigned to this Pipeline's Region");
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
    // Audit attribution must come from the server, never from a client value.
    if (differs("status") && String(changes.status).toLowerCase() === "archived") {
      changes.archived_at = stamp;
    }
    return changes;
  }

  const entityApi = {
    list(uiEntity, actor, { sort, limit, query } = {}) {
      const b = binding(uiEntity);
      need(actor, b, "read");
      if (ENTITIES[uiEntity].virtual) return appConfigList();
      const inScope = scopedFilter(b, actor);
      let out = tableOf(b).rows.filter(inScope);
      if (uiEntity === "Opportunity") out = out.filter((row) => !isSoftDeleted(row));
      if (uiEntity === "TeamMember") out = out.filter((r) => directoryVisible(actor, r.user_id));
      out = out.map((r) => visibleMember(actor, uiEntity, decorate(uiEntity, toUi(uiEntity, b.primary_key, r))));
      out = sortRows(out.filter((r) => matches(r, query)), sort);
      return limit ? out.slice(0, Number(limit)) : out;
    },
    get(uiEntity, actor, id) {
      const b = binding(uiEntity);
      need(actor, b, "read");
      if (ENTITIES[uiEntity].virtual) return appConfigList().find((c) => c.id === id);
      const row = findRow(b, actor, id);
      if (uiEntity === "Opportunity" && isSoftDeleted(row))
        throw new HttpError(404, "Pipeline is in Recycle Bin");
      if (uiEntity === "TeamMember" && !directoryVisible(actor, row.user_id)) {
        throw new HttpError(404, "Team member not found");
      }
      return visibleMember(actor, uiEntity, decorate(uiEntity, toUi(uiEntity, b.primary_key, row)));
    },
    create(uiEntity, actor, data, importMeta = null) {
      rejectRetiredSupportPayload(uiEntity, data);
      const b = binding(uiEntity);
      if (ENTITIES[uiEntity].virtual) return appConfigSet(actor, data.key, data.value);
      need(actor, b, "create");
      if (uiEntity === "OpportunityHistory" || uiEntity === "MonthlySnapshot") {
        throw new HttpError(403, "System-controlled entity; use the Pipeline or snapshot API");
      }
      if (uiEntity === "Stage" || uiEntity === "WorkingWithOption") validateStageSla(data);
      if (uiEntity === "TeamMember") validateTeamMemberInput(data);
      const stamp = now();
      let importedCreatedMonth = "";
      if (uiEntity === "Opportunity") {
        // Only the trusted imports/opportunities handler supplies importMeta.
        // Normal Create/Edit cannot set the source-created reporting month.
        importedCreatedMonth = importMeta ? importMeta.createdMonth : "";
        if (importedCreatedMonth &&
            (!isMonthKey(importedCreatedMonth) ||
             Number(importedCreatedMonth.slice(0, 4)) < 1900 ||
             Number(importedCreatedMonth.slice(0, 4)) > 2100)) {
          throw new HttpError(400, "source_created_month must be a valid YYYY-MM from 1900 to 2100");
        }
        data = stripSystemFields(data);
        // Legacy import and older clients may send retired labels; persist only canonical values.
        if ("sales_channel" in data) data.sales_channel = normalizeSalesChannel(data.sales_channel) || data.sales_channel;
        if (!importMeta && !String(data.client_request_id || "").trim()) {
          throw new HttpError(400, "Client request ID is required");
        }
        if (!importMeta && data.client_request_id) {
          const requestId = String(data.client_request_id);
          if (!/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) throw new HttpError(400, "Invalid client request ID");
          const previous = tableOf(b).rows.find((r) => r.client_request_id === requestId);
          if (previous) {
            if (String(previous.created_by_user_id) !== String(actor.real.id)) throw new HttpError(409, "Request ID in use");
            const candidate = toSheet("Opportunity", b.primary_key, namesToIds("Opportunity", data));
            const keys = ["customer_name", "business_id", "product_category_id", "owner_user_id", "region_id", "quantity", "price_per_sub", "expected_close_month"];
            if (keys.some((key) => key in candidate && String(candidate[key] ?? "") !== String(previous[key] ?? ""))) throw new HttpError(409, "Request ID changed payload");
            if (!scopedFilter(b, actor)(previous)) throw new HttpError(403, "Pipeline is outside scope");
            return { ...decorate("Opportunity", toUi("Opportunity", b.primary_key, previous)), _audit_events: [] };
          }
        }
        if (importMeta) data = {
          ...data, customer_type: importMeta.normalizedCustomerType || data.customer_type,
          import_batch_id:importMeta.batchId,
          import_row_number:importMeta.rowNumber,
          import_row_signature:importMeta.signature,
        };
        // New Pipelines always start Open. Close them via the audited
        // Won/Lost update flow, which requires a Lost Reason when applicable.
        if (!importMeta && String(data.status || "open").toLowerCase() !== "open") {
          throw new HttpError(400, "Create Pipeline as Open, then use Mark Won or Mark Lost");
        }
        // New AE modal fields must be validated server-side as well.
        // Imported historical data without sales_channel is handled separately.
        if (!["sm", "admin"].includes(actor.role) && (data.scenario_id || data.ccp_check_result)) {
          throw new HttpError(403, "Only SM or Admin can set Scenario and CCP+ Check");
        }
        if (actor.role === "ae" && String(data.owner_id || "") !== String(actor.id)) {
          throw new HttpError(403, "AE must create Pipelines owned by their own account");
        }
        validateLatestOpportunityFields(data, { requireRequired: !!importMeta || "sales_channel" in data,
          additionalCustomerTypes: importMeta?.allowedTypes || [], allowedSalesChannels: activeSalesChannelOptions().map(option => option.value), legacyImport:!!importMeta });
        if ("customer_type" in data) data = { ...data, customer_type: normalizeCustomerType(data.customer_type) || data.customer_type };
      }
      // Only the trusted import API can bypass live price/quantity validation.
      // Its financial value comes from verified numeric Net RC in the source,
      // NEVER from a manufactured unit price, zero fallback or browser override.
      const checked = uiEntity !== "Opportunity" ? data : importMeta
        ? { ...data, quantity: importMeta.historicalQuantity,
            price_per_sub: data.price_per_sub == null || data.price_per_sub === "" ? null : data.price_per_sub,
            oc: importMeta.numericOc,
            pipeline_value: importMeta.numericNetRc }
        : normalizeOpportunityPricing(data);
      let row = toSheet(uiEntity, b.primary_key, namesToIds(uiEntity, checked));
      if (b.entity === "opportunities") {
        row = keepOpportunityColumns(row);
        row.status = importMeta ? importMeta.status : "Open";
        row.current_handler_user_id = row.current_handler_user_id || row.owner_user_id;
        row.original_owner_user_id = row.owner_user_id;
        // Import-only: an unknown source creation month must remain unknown, not become the import month.
        row.created_month = importMeta ? importedCreatedMonth : bangkokMonth(stamp);
        // Unknown legacy stage-entry date stays unknown, never impersonates real Stage Aging.
        row.stage_entered_at = importMeta ? (importMeta.sourceStageEnteredAt || "") : stamp;
        row.handler_since = stamp;
        if (importMeta) {
          const provenance = {
            import_source_record_id: importMeta.sourceRecordId,
            import_source_legacy_record_id: importMeta.sourceLegacyRecordId,
            import_source_row: importMeta.sourceRow,
            import_source_system: importMeta.sourceSystem,
            import_source_product_id: importMeta.sourceProductId,
            import_source_rc: importMeta.sourceRc,
            import_source_discount_pct: importMeta.sourceDiscountPct,
            import_source_monthly_sale_plan: importMeta.sourceMonthlySalePlan,
            import_source_net_rc: importMeta.sourceNetRc,
            import_source_customer_type: importMeta.sourceCustomerType,
            import_source_sales_code: importMeta.originalSalesCode,
            import_source_subs: importMeta.originalSubs,
            import_source_oc: importMeta.originalOc,
            import_source_business_id: importMeta.originalBusinessId,
            import_source_sales_channel: importMeta.originalChannel,
            import_source_region: importMeta.originalRegion,
            import_source_stage: importMeta.originalStage,
            import_source_workbook: importMeta.sourceWorkbook,
            import_source_created_at_raw: importMeta.originalCreatedDate,
            import_source_created_month_raw: importMeta.originalCreatedMonth,
            import_source_closed_at_raw: importMeta.originalClosedDate,
            import_source_stage_entered_at_raw: importMeta.originalStageEnteredDate,
          };
          for (const [key, value] of Object.entries(provenance)) if (value !== "") row[key] = value;
          if (importMeta.status === "Won") row.won_at = importMeta.sourceClosedAt;
          if (importMeta.status === "Lost") {
            row.lost_at = importMeta.sourceClosedAt;
            row.lost_reason_id = importMeta.lostReasonId;
          }
        }
        row.working_with_since = row.working_with_id ? stamp : "";
        if (bool.toUi(row.support_needed) &&
            (!String(row.support_type_id || "").trim() || !String(row.support_note || "").trim()))
          throw new HttpError(400,"Select Support Type and enter Support Note");
        validateOpportunityRefs(row, null, actor, {
          allowPendingPartnerAe: importMeta?.pendingPartnerAe === true,
          allowApprovedHistoricalStage3: importMeta?.approvedHistoricalStage3 === true,
          allowUnknownHistoricalRegion: !!importMeta,
        });
      }
      row[b.primary_key] = nextId(b, ENTITIES[uiEntity].idPrefix);
      if (b.entity === "users") validateUserMasterChange(row);
      if (b.append_only) {
        // Events are system records: actor and time are set by the backend.
        row.actor_user_id = actor.real.id;
        row.actor_name = actor.real.name;
        row.event_at = stamp;
      } else {
        row.created_at = stamp;
        row.updated_at = stamp;
      }
      if (b.entity === "opportunities") {
        // An import audit event uses today; the historical Opportunity creation date does not.
        if (importMeta) row.created_at = importMeta.sourceCreatedAt || "";
        row.created_by_user_id = actor.real.id;
        validateCollaborators(row, row.region_id);
        // Multi-team input can populate its primary mirror during validation.
        // On NEW live Pipelines only, initialize that legacy clock at creation.
        // Never backdate or invent assignment timestamps for historical imports.
        if (!importMeta && row.working_with_id && !row.working_with_since) {
          row.working_with_since = stamp;
        }
      }
      if (b.scoped && !scopedFilter(b, actor)(row)) throw new HttpError(403, `New ${b.sheet} row would be outside your scope`);
      const saved = fitColumns(b, row);
      tableOf(b).rows.push(saved);
      touch(b);
      if (uiEntity === "TeamMember") syncUserRegions(row[b.primary_key], data.region_ids);
      const createEvents = b.entity === "opportunities" ? opportunityAuditEvents(null, saved) : [];
      // New live Pipeline team selections need a real start event so all teams
      // have independently verifiable clocks, not only the legacy primary team.
      // Historical imports are not timestamped as if they had just been assigned.
      if (b.entity === "opportunities" && !importMeta) {
        const initialTeams = String(saved.working_with_team_ids || saved.working_with_id || "").trim();
        if (initialTeams) createEvents.push({
          event_type: "working_with_change", field: "working_with_teams",
          previous_value: "", new_value: initialTeams,
          remark: "Initial Working With assignment on Pipeline creation",
        });
      }
      const auditEvents = b.entity === "opportunities"
        ? appendAudit(saved[b.primary_key], createEvents.map(event =>
            importMeta ? { ...event, remark:"Historical bulk import; batch " + importMeta.batchId } : event), actor, stamp)
        : [];
      if (b.entity === "opportunities" && String(saved.status).toLowerCase() === "open") addCreationNotifications(saved, actor, stamp);
      if (b.entity === "opportunities" && importMeta && importMeta.status !== "Open") {
        appendAudit(saved[b.primary_key], [{ event_type:"historical_import_status", field:"status",
          previous_value:"", new_value:importMeta.status, remark:"Imported historical status; event_at is the import time" }], actor, stamp);
      }
      if (b.entity !== "opportunities" && !b.scoped) outputs.logMaster("CREATED", b, saved[b.primary_key], null, saved, actor);
      const created = decorate(uiEntity, toUi(uiEntity, b.primary_key, row));
      return b.entity === "opportunities" ? { ...created, _audit_events: auditEvents } : created;
    },
    update(uiEntity, actor, id, data) {
      rejectRetiredSupportPayload(uiEntity, data);
      const b = binding(uiEntity);
      if (ENTITIES[uiEntity].virtual) return appConfigSet(actor, id, data.value);
      need(actor, b, "update");
      if (uiEntity === "OpportunityHistory" || uiEntity === "MonthlySnapshot") {
        throw new HttpError(403, "System-controlled entity");
      }
      if (uiEntity === "Stage" || uiEntity === "WorkingWithOption") validateStageSla(data);
      if (uiEntity === "TeamMember") validateTeamMemberInput(data);
      // A precondition refers to the authoritative row revision, not a field
      // supplied for persistence. Compare before any mutation, including audit.
      const expectedUpdatedAt = uiEntity === "Opportunity" ? data.expected_updated_at : undefined;
      if (uiEntity === "Opportunity") {
        data = stripSystemFields(data);
        delete data.expected_updated_at;
        if ("client_request_id" in data) throw new HttpError(403, "Request identity cannot be edited");
      }
      const row = findRow(b, actor, id);
      if (uiEntity === "Opportunity" && isSoftDeleted(row))
        throw new HttpError(409, "Pipeline is in Recycle Bin. Restore before editing.");
      if (uiEntity === "Opportunity") {
        // The empty string is still an explicit revision token for a legacy
        // row whose stored updated_at was blank. Compare-and-set below blocks
        // stale callers; null/omitted revisions remain forbidden.
        if (typeof expectedUpdatedAt !== "string") {
          throw new HttpError(428, "Pipeline revision is required. Refresh before saving.");
        }
        // A known historical import can carry a blank first revision.
        // The explicit empty token is compared to the current blank cell;
        // after the first successful edit it becomes a server timestamp.
        if (String(expectedUpdatedAt) !== String(row.updated_at || "")) {
          throw new HttpError(409, "This Pipeline was updated by someone else. Refresh it before saving.");
        }
      }
      const before = { ...row };
      if (uiEntity === "TeamMember") {
        const proposed = toSheet(uiEntity, b.primary_key, data);
        validateUserMasterChange({ ...proposed, user_id: row.user_id }, row);
      }
      if (uiEntity === "Opportunity") {
        const prior = String(row.status || "Open").toLowerCase();
        const desired = "status" in data ? String(data.status || "").toLowerCase() : prior;
        const roleCanReopen = ["sm", "management", "admin"].includes(actor.role);
        const transition = desired !== prior;
        // Retired Stage IDs remain on historical rows. A Reopen must not create
        // a new Open Pipeline in an inactive Stage; explicitly select any active
        // Stage from the master. This works with 2, 3, 4 or more stages.
        const stageActive = !bindings.stages || rows("stages").some((stage) =>
          String(stage.stage_id) === String(row.stage_id) && isActive(stage.active));
        const reopeningWithInactiveStage = transition && desired === "open" &&
          prior !== "open" && !stageActive;
        if (reopeningWithInactiveStage && !rows("stages").some((stage) =>
            String(stage.stage_id) === String(data.stage_id || "") && isActive(stage.active))) {
          throw new HttpError(400, "Select an active Stage when reopening a Pipeline with a retired Stage");
        }
        if (transition && desired === "archived" && !roleCanReopen) {
          throw new HttpError(403, "Only SM, Management or Admin can Archive a Pipeline");
        }
        if (transition && desired === "open" && prior !== "open") {
          if (!roleCanReopen) throw new HttpError(403, "Only SM, Management or Admin can Reopen a Pipeline");
          if (!String(data.audit_remark || "").trim()) throw new HttpError(400, "Reopen reason is required");
        }
        if (prior !== "open") {
          // Closed Pipelines are immutable except for harmless remarks or a
          // separately audited status transition. Reopen is never bundled with
          // edits to Stage, Handler, ownership, customer or financial fields.
          const allowed = new Set(["status", "remark", "last_remark", "audit_remark",
            ...(reopeningWithInactiveStage ? ["stage_id"] : [])]);
          for (const field of Object.keys(data)) {
            if (!allowed.has(field)) {
              throw new HttpError(409, "Reopen the Pipeline before editing " + field);
            }
          }
          if (desired === "open" && Object.keys(data).some((f) =>
              !["status", "audit_remark", ...(reopeningWithInactiveStage ? ["stage_id"] : [])].includes(f))) {
            throw new HttpError(400, "Reopen and edit must be separate audited actions");
          }
        }
      }
      if (uiEntity === "Opportunity" && ["ae", "management"].includes(actor.role)) {
        const current = toUi(uiEntity, b.primary_key, row);
        if (actor.role === "ae" && "owner_id" in data && String(data.owner_id) !== String(current.owner_id)) {
          throw new HttpError(403, "Only SM or Admin may reassign commercial ownership");
        }
        for (const field of ["scenario_id", "ccp_check_result"]) {
          if (field in data && String(data[field] || "") !== String(current[field] || "")) {
            throw new HttpError(403, "Only SM or Admin can update " + field);
          }
        }
      }
      // Validate latest editable fields on partial updates without breaking
      // workflow-only updates such as Stage / Handler / Support.
      if (uiEntity === "Opportunity") {
        if ("sales_channel" in data) data.sales_channel = normalizeSalesChannel(data.sales_channel) || data.sales_channel;
        validateLatestOpportunityFields(data, { previousBusinessId: row.business_id, allowedSalesChannels: "sales_channel" in data ? activeSalesChannelOptions().map(option => option.value) : [] });
        if ("customer_type" in data) data = { ...data, customer_type: normalizeCustomerType(data.customer_type) || data.customer_type };
      }

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
        // The prior close-out is preserved in Pipeline_Events. On Reopen,
        // clear current-state close-out fields so future Won/Lost is unambiguous.
        if (String(normalized.status || "").toLowerCase() === "open" &&
            String(row.status || "open").toLowerCase() !== "open") {
          Object.assign(normalized, {
            won_at: "", won_by_user_id: "", lost_at: "", lost_by_user_id: "",
            lost_reason_id: "", lost_note: "", archived_at: "",
          });
        }
      }
      const checked = uiEntity === "Opportunity"
        ? normalizeOpportunityPricing(normalized, toUi(uiEntity, b.primary_key, row))
        : data;
      let changes = toSheet(uiEntity, b.primary_key, namesToIds(uiEntity, checked));
      delete changes[b.primary_key];
      // Free-text audit remark is metadata, never a Pipeline column.
      delete changes.audit_remark;
      // Keep business timers on actual server time. Revision alone is
      // monotonic, so two saves during the same millisecond cannot reuse a tag.
      const stamp = now();
      const priorMs = Date.parse(row.updated_at || "");
      const currentMs = Date.parse(stamp);
      const revisionStamp = b.entity === "opportunities" &&
        Number.isFinite(priorMs) && Number.isFinite(currentMs) && currentMs <= priorMs
        ? new Date(priorMs + 1).toISOString() : stamp;
      if (b.entity === "opportunities") {
        changes = applyOpportunityTimers(keepOpportunityColumns(changes), row, stamp);
        const next = { ...row, ...changes };
        validateCollaborators(changes,next.region_id);
        if ("working_with_team_ids" in changes &&
            String(changes.working_with_id || "") !== String(row.working_with_id || ""))
          changes.working_with_since = changes.working_with_id ? stamp : "";
        Object.assign(next, changes);
        validateOpportunityRefs(next, row, actor);
        // A simple Support Needed toggle is enough for Pipeline coordination.
        // Type/note are required only when turning it on; turning it off clears
        // the current values and remains fully audited in Pipeline_Events.
        if ("support_needed" in changes && !bool.toUi(next.support_needed)) {
          changes.support_type_id = "";
          changes.support_note = "";
          next.support_type_id = "";
          next.support_note = "";
        }
        if (bool.toUi(next.support_needed) && !bool.toUi(row.support_needed) &&
            (!String(next.support_type_id || "").trim() || !String(next.support_note || "").trim()))
          throw new HttpError(400,"Select Support Type and enter Support Note");
        // Do not let Region changes move the row out of the editor's scope.
        if (String(next.region_id ?? "") !== String(row.region_id ?? "") &&
            !scopedFilter(b, actor)(next)) {
          throw new HttpError(403, "Region change would move Pipeline outside your scope");
        }
      }
      Object.assign(row, fitColumns(b, { ...changes, updated_at: revisionStamp }));
      touch(b);
      if (b.entity === "opportunities" && String(before.current_handler_user_id||"") !==
          String(row.current_handler_user_id||""))
        addHandoffNotification(id,before.current_handler_user_id,row.current_handler_user_id,actor,stamp);
      const auditEvents = b.entity === "opportunities"
        ? appendAudit(id, opportunityAuditEvents(before, row, { remark: data.audit_remark || data.last_remark || "" }), actor, stamp)
        : [];
      if (uiEntity === "TeamMember") syncUserRegions(id, data.region_ids);
      if (b.entity !== "opportunities" && !b.scoped) outputs.logMaster("UPDATED", b, id, before, row, actor);
      const updated = decorate(uiEntity, toUi(uiEntity, b.primary_key, row));
      return b.entity === "opportunities" ? { ...updated, _audit_events: auditEvents } : updated;
    },
    remove(uiEntity, actor, id) {
      // Pipeline deletion must ALWAYS use the authenticated, audited Recycle Bin
      // endpoint, not the generic hard-delete API—even if YAML is misconfigured.
      if (uiEntity === "Opportunity")
        throw new HttpError(405, "Hard deletion is disabled. Use Recycle Bin soft delete.");
      if (uiEntity === "SupportType") throw new HttpError(410, "Support feature has been retired");
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
    removeMany(uiEntity) {
      if (uiEntity === "SupportType") throw new HttpError(410, "Support feature has been retired");
      if (uiEntity === "OpportunityHistory" || uiEntity === "MonthlySnapshot") {
        throw new HttpError(403, "System-controlled entity");
      }
      // No UI needs bulk deletes. Never allow bypassing foreign-key checks,
      // Admin_Audit or app-owned data ownership rules via an empty filter.
      throw new HttpError(405, "Bulk deletion is disabled. Delete individual records with audit checks.");
    },
  };

  // ---- Recycle Bin: authenticated AE/SM-scoped soft delete + append-only audit ----
  // Never invoke the generic remove() for Pipelines or change business status.
  function recyclePipeline(actor, id, input = {}, restore = false) {
    const b = binding("Opportunity");
    need(actor, b, "read");
    need(actor, b, "update");
    if (!["ae", "sm", "management", "admin"].includes(actor.role))
      throw new HttpError(403, "Pipeline deletion requires an authorized sales role");
    // Demo-As is for inspection/training, not a means to delete real records.
    if (actor.real?.id && String(actor.real.id) !== String(actor.id))
      throw new HttpError(403, "Exit Demo As before deleting or restoring Pipelines");
    const row = findRow(b, actor, id); // authoritative AE owner/handler, SM Region scope
    const wasDeleted = isSoftDeleted(row);
    if (restore ? !wasDeleted : wasDeleted)
      throw new HttpError(409, restore ? "Pipeline is not in Recycle Bin" : "Pipeline already deleted");
    const reason = String(input.reason || "").trim();
    if (reason.length < 3 || reason.length > 500)
      throw new HttpError(400, "A reason between 3 and 500 characters is required");
    if (typeof input.expected_updated_at !== "string")
      throw new HttpError(428, "Pipeline revision is required. Refresh before saving.");
    if (input.expected_updated_at !== String(row.updated_at || ""))
      throw new HttpError(409, "Pipeline changed. Refresh before retrying.");
    const auditBinding = bindings.opportunity_events;
    if (!auditBinding) throw new HttpError(503, "Pipeline_Events is required for deletion");
    const original = { ...row };
    const auditTable = tableOf(auditBinding);
    const originalEventCount = auditTable.rows.length;
    const stamp = now();
    const oldMs = Date.parse(row.updated_at || "");
    const newMs = Date.parse(stamp);
    const revision = Number.isFinite(oldMs) && Number.isFinite(newMs) && newMs <= oldMs
      ? new Date(oldMs + 1).toISOString() : stamp;
    const fields = restore
      ? { deleted_at: "", deleted_by_user_id: "", delete_reason: "" }
      : { deleted_at: stamp, deleted_by_user_id: actor.real.id, delete_reason: reason };
    try {
      Object.assign(row, fields, { updated_at: revision });
      touch(b);
      const events = appendAudit(id, [{
        event_type: restore ? "pipeline_restored" : "pipeline_deleted",
        field: "soft_delete", previous_value: restore ? "Deleted" : "Active",
        new_value: restore ? "Active" : "Deleted", remark: reason,
      }], actor, stamp);
      return { ok: true, pipeline_id: id, restored: restore, _audit_events: events };
    } catch (error) {
      Object.keys(row).forEach((key) => { if (!(key in original)) delete row[key]; });
      Object.assign(row, original);
      auditTable.rows.splice(originalEventCount);
      teamEventIndex = null;
      touch(b);
      touch(auditBinding);
      throw error;
    }
  }
  function listDeletedPipelines(actor) {
    const b = binding("Opportunity");
    need(actor, b, "read");
    return tableOf(b).rows.filter(scopedFilter(b, actor)).filter(isSoftDeleted)
      .map((row) => toUi("Opportunity", b.primary_key, row))
      .sort((a,b) => Date.parse(b.deleted_at || "") - Date.parse(a.deleted_at || ""));
  }

  // ---- Sheet API (generic row editor over any sheet bound in access_control) ----
  const actionsFor = (actor, rule) => Object.keys(rule.permissions || {}).filter((a) => can(actor.role, rule, a));
  function sheetRule(file, sheet) {
    const rule = sheetRules[`${file}/${sheet}`];
    if (!rule) throw new HttpError(404, `${file} / ${sheet} is not available (not listed in access_control)`);
    return rule;
  }
  // Keep IDs and codes as text; convert plain numbers typed into the editor.
  const cellIn = (v, col) => {
    // Identity, codes, IDs and month keys must retain text semantics.
    // Never convert "90005595", "0812345678" or a code to a Number.
    if (AUTH_USER_FIELDS.has(col) || col === "contact_phone" || col === "business_id" ||
        col.endsWith("_id") || col.endsWith("_month") || col.endsWith("_period") ||
        col === "phone" || col === "username") return v ?? "";
    return typeof v === "string" && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v.trim()) ? Number(v) : v ?? "";
  };

  const sheetApi = {
    list(actor) {
      return Object.values(sheetRules).filter((r) => !["support_types", "support_requests"].includes(r.entity))
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
      return {
        file, sheet, primary_key: b.primary_key,
        headers: b.entity === "users" && actor.role !== "admin" ? headers.filter((h) => h !== "employee_id") : headers,
        rows: t.rows.filter(scopedFilter(b, actor)).filter((r) =>
          b.entity === "users" ? directoryVisible(actor, r.user_id) :
          b.entity === "user_regions" ? directoryVisible(actor, r.user_id) : true
        ).map((r) => visibleSheetRow(actor, b, r)),
        actions: actionsFor(actor, b),
      };
    },
    create(actor, file, sheet, data) {
      const b = sheetRule(file, sheet);
      if (["support_types", "support_requests"].includes(b.entity)) throw new HttpError(410, "Support feature has been retired");
      need(actor, b, "create");
      if (b.append_only || b.scoped) throw new HttpError(400, `${sheet} is maintained by the app — edit it from the Pipeline screens`);
      const t = tableOf(b);
      const row = Object.fromEntries(Object.entries(fitColumns(b, data || {})).map(([k, v]) => [k, cellIn(v, k)]));
      const id = String(row[b.primary_key] ?? "").trim() || nextId(b);
      if (t.rows.some((r) => String(r[b.primary_key]) === id)) throw new HttpError(409, `${b.primary_key} ${id} already exists`);
      row[b.primary_key] = id;
      if (b.entity === "users") validateUserMasterChange(row);
      t.rows.push(row);
      touch(b);
      outputs.logMaster("CREATED", b, id, null, row, actor);
      return row;
    },
    update(actor, file, sheet, id, data) {
      const b = sheetRule(file, sheet);
      if (["support_types", "support_requests"].includes(b.entity)) throw new HttpError(410, "Support feature has been retired");
      need(actor, b, "update");
      if (b.append_only || b.scoped) throw new HttpError(400, `${sheet} is maintained by the app — edit it from the Pipeline screens`);
      const row = findRow(b, actor, id);
      const before = { ...row };
      const checked = fitColumns(b, data || {});
      const changes = Object.fromEntries(Object.entries(checked)
        .filter(([k]) => k !== b.primary_key)
        .map(([k, v]) => [k, cellIn(v, k)]));
      if (b.entity === "users") validateUserMasterChange(changes, row);
      Object.assign(row, changes);
      touch(b);
      outputs.logMaster("UPDATED", b, id, before, row, actor);
      return row;
    },
    remove(actor, file, sheet, id) {
      const b = sheetRule(file, sheet);
      if (["support_types", "support_requests"].includes(b.entity)) throw new HttpError(410, "Support feature has been retired");
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

    // Legacy troubleshooting endpoint: only authenticated Admins may enumerate users.
    if (parts[0] === "session" && parts[1] === "users" && method === "GET") {
      if (actorFrom(req.userId, req.demoAs).role !== "admin") {
        throw new HttpError(403, "Admin access required");
      }
      return rows("users")
        .filter((u) => String(u.status || "Active").toLowerCase() === "active")
        .map((u) => ({ id: u.user_id, name: u.display_name, email: u.email, role: u.role }));
    }

    // Several read requests in one round trip (Apps Script calls are slow): { requests: [{ path, query }] }
    if (parts[0] === "batch") {
      if (method !== "POST") throw new HttpError(405, "Batch requires POST");
      const requests = req.body?.requests;
      if (!Array.isArray(requests) || requests.length > 30) {
        throw new HttpError(400, "Batch requires an array of at most 30 read requests");
      }
      for (const sub of requests) {
        if (!sub || typeof sub.path !== "string" ||
            (sub.method && sub.method !== "GET") ||
            String(sub.path).replace(/^\/+/, "").split("/")[0] === "batch") {
          throw new HttpError(400, "Batch only supports non-nested GET requests");
        }
      }
      return requests.map((sub) => {
        try {
          return { status: 200, body: handle({ ...sub, method: "GET", userId: req.userId, demoAs: req.demoAs }) };
        } catch (e) {
          if (!e.status) throw e;
          return { status: e.status, body: e.status >= 500
            ? { message: "Backend data source unavailable. Contact support.", code: e.publicCode || "BACKEND_ERROR" }
            : { message: e.message } };
        }
      });
    }

    const actor = actorFrom(req.userId, req.demoAs);

    if (parts[0] === "session" && parts[1] === "me") {
      const r = actor.real;
      return { id: r.id, email: r.email, full_name: r.name, role: r.role,
        api_contract_version: API_CONTRACT_VERSION, capabilities: [...REQUIRED_CAPABILITIES, UAT_EMAIL_ACTIVATION_CAPABILITY] };
    }

    if (parts[0] === "config" && parts[1] === "sales-channels" && parts.length === 2) {
      if (method !== "GET") throw new HttpError(405, "Sales Channel Config is read-only");
      need(actor, binding("Opportunity"), "read");
      return { options: activeSalesChannelOptions() };
    }

    if (parts[0] === "config" && parts[1] === "field-options" &&
        parts[2] === "ccp_check_result" && parts.length === 3) {
      if (method !== "GET") throw new HttpError(405, "CCP+ Config is read-only");
      need(actor, binding("Opportunity"), "read");
      return { options: activeCcpCheckOptions() };
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

    if (parts[0] === "activity-log") {
      if (method !== "GET" || parts.length !== 1) throw new HttpError(405, "Activity Log is read-only");
      if (!["sm","management","admin"].includes(actor.role)) throw new HttpError(403, "Activity Log requires SM or Management access");
      // Check existing entity read contracts, then narrow AGAIN by the actor role
      // and current AE/region assignment in the dedicated query helper.
      need(actor, binding("Opportunity"), "read");
      need(actor, binding("OpportunityHistory"), "read");
      return buildTeamActivityLog({
        actor,
        opportunities:rows("opportunities").filter(scopeFn(actor)),
        events:rows("opportunity_events"),
        users:rows("users"),
        userRegions:rows("user_regions"),
        filters:query,
      });
    }

    if (parts[0] === "tasks") {
      if (method === "GET" && parts.length <= 2) return { items: taskRows(actor, parts[1] || "") };
      if (method === "POST" && parts.length === 3)
        return saveTaskProgress(actor, parts[1], parts[2], req.body || {});
      throw new HttpError(405, "Invalid Task operation");
    }
    if (parts[0] === "notifications") {
      if (method === "GET" && parts.length === 1) return listNotifications(actor);
      if (method === "POST" && parts[2] === "read" && parts.length === 3)
        return readNotification(actor,parts[1]);
      throw new HttpError(405,"Notifications only support list and mark-read");
    }
    if (parts[0] === "support-requests") {
      // Stop old browser clients from writing ticket records after toggle-only cutover.
      throw new HttpError(410,"Support feature has been retired.");
    }

    if (parts[0] === "imports" && parts[1] === "resolve-owners" && method === "POST") {
      return resolveLegacyImportOwners(actor, req.body);
    }
    if (parts[0] === "imports" && parts[1] === "customer-types" && method === "GET") {
      if (!["sm", "admin"].includes(actor.role)) throw new HttpError(403, "Import options require SM or Admin");
      return { values: importCustomerTypes() };
    }
    if (parts[0] === "imports" && parts[1] === "preview") {
      if (method !== "POST") throw new HttpError(405, "Import preview requires POST");
      return previewImportOpportunities(actor,req.body||{});
    }
    if (parts[0] === "imports" && parts[1] === "opportunities") {
      if (method !== "POST") throw new HttpError(405, "Import requires POST");
      return importOpportunities(actor, req.body);
    }

    if (parts[0] === "pipeline-trash") {
      if (method === "GET" && parts.length === 1) return listDeletedPipelines(actor);
      if (method === "POST" && parts.length === 3 && ["delete","restore"].includes(parts[2]))
        return recyclePipeline(actor, parts[1], req.body || {}, parts[2] === "restore");
      throw new HttpError(405, "Use Recycle Bin list, delete or restore");
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

  return { handle, bindings, captureScheduledSnapshot };
}
