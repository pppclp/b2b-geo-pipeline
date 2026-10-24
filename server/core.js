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
  // Bound each user-editable text field before Google Sheets receives the value.
  // Limits match ordinary sales usage; do not trim data silently on the server.
  const textLimits = {
    customer_name: 200, contact_name: 120, contact_phone: 40,
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
      // Never grant nationwide access from a missing/empty User_Region mapping.
      // Management access to all Regions requires explicit active Region rows.
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
  // Identity used for sign-in must not leak via ordinary team directories.
  // Admin retains access for account provisioning; UI hiding alone is not a guard.
  // Restrict the actual server response, not merely the browser dropdown.
  // A member is visible when they share an active Region assignment, or are self.
  function directoryVisible(actor, userId) {
    if (actor.role === "admin" || String(userId) === String(actor.real.id)) return true;
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

  // Stable import identity: indexed batch IDs prevent retry duplicates;
  // a second batch containing the same commercial signature is rejected.
  const importFingerprint = (item) => JSON.stringify([
    "business_id","product_category_id","expected_close_month","owner_id",
    "product_details","contact_phone","quantity","price_per_sub","oc"
  ].map((key) => String(item[key] ?? "").trim().toLowerCase()));

  function importOpportunities(actor, input) {
    const b = binding("Opportunity");
    need(actor, b, "import");
    need(actor, b, "create");
    if (!["sm", "admin"].includes(actor.role)) throw new HttpError(403, "Only SM or Admin may import Pipelines");
    const batchId = String(input?.batch_id || "");
    const items = input?.items;
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(batchId)) throw new HttpError(400, "Invalid import_batch_id");
    if (!Array.isArray(items) || items.length < 1 || items.length > 200 ||
      items.some((i) => !i || typeof i !== "object" || Array.isArray(i))) {
      throw new HttpError(400, "Import must contain 1-200 Pipeline rows");
    }
    const sheet = tableOf(b).rows;
    const previous = sheet.filter((r) => String(r.import_batch_id || "") === batchId);
    if (previous.length) {
      if (previous.length !== items.length ||
          previous.some((r) => {
            const n = Number(r.import_row_number);
            return !Number.isInteger(n) || n < 1 || n > items.length ||
              String(r.import_row_signature || "") !== importFingerprint(items[n - 1]);
          })) throw new HttpError(409, "Import batch ID was already used with different or partial data");
      return { imported: 0, already_imported: true, total: previous.length,
        opportunity_ids: previous.slice().sort((a,b) => Number(a.import_row_number) - Number(b.import_row_number))
          .map((r) => r.opportunity_id) };
    }
    const known = new Set(sheet.map((r) => r.import_row_signature || importFingerprint({
      business_id:r.business_id, product_category_id:r.product_category_id,
      expected_close_month:r.expected_close_month, owner_id:r.owner_user_id,
      product_details:r.product_details, contact_phone:r.contact_phone,
      quantity:r.quantity, price_per_sub:r.price_per_sub, oc:r.oc,
    })));
    const currentBatch = new Set();
    const signatures = items.map((item) => {
      const sign = importFingerprint(item);
      if (currentBatch.has(sign)) throw new HttpError(409, "Duplicate Pipeline rows in import file");
      if (known.has(sign)) throw new HttpError(409, "This Pipeline already exists. Review your import before retrying");
      currentBatch.add(sign);
      return sign;
    });
    // One core request: adapters commit Pipelines + Pipeline_Events together.
    // If any validation or sheet write fails, neither workbook change commits.
    const results = items.map((item, index) => entityApi.create("Opportunity", actor, item, {
      batchId, rowNumber:index + 1, signature:signatures[index]
    }));
    return { imported: results.length, already_imported: false, total: results.length,
      opportunity_ids: results.map((r) => r.id) };
  }

  // All notification/support APIs use the signed actor from the server.
  // Never expose these app-owned tables via generic entity or raw Sheet APIs.
  const notificationBinding = bindings.handoff_notifications;
  const supportBinding = bindings.support_requests;
  const notificationRows = () => notificationBinding ? tableOf(notificationBinding).rows : [];
  const supportRows = () => supportBinding ? tableOf(supportBinding).rows : [];
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
    const mine = notificationRows().filter((n) => n.recipient_user_id === actor.real.id);
    const visible = mine.filter((n) => {
      const b = binding("Opportunity");
      const op = tableOf(b).rows.find((o) => o.opportunity_id === n.opportunity_id);
      return !!op && scopedFilter(b, actor)(op);
    });
    return {
      unread_count: visible.filter((n) => !n.read_at).length,
      items: visible.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 30)
        .map((n) => ({ id:n.notification_id, opportunity_id:n.opportunity_id,
          actor_name:findUser(n.actor_user_id)?.name || "Colleague",
          type:n.type || "handoff", customer_name:opportunityName(n.opportunity_id),
          needs_sm_input:needsSmInputById(n.opportunity_id),
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
  function supportVisible(actor, request) {
    const b=binding("Opportunity");
    const op=tableOf(b).rows.find((r) => r.opportunity_id === request.opportunity_id);
    return !!op && scopedFilter(b,actor)(op);
  }
  function listSupport(actor) {
    if (!supportBinding) throw new HttpError(503, "Support Requests need database setup");
    return supportRows().filter((r) => supportVisible(actor,r))
      .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((r) => ({ ...r }));
  }
  function openSupportRequest(actor, opportunityId, categoryId, note, stamp) {
    if (!supportBinding) throw new HttpError(503, "Support Requests need database setup");
    const b=binding("Opportunity"),op=findRow(b,actor,opportunityId);
    if (!["open","won","lost"].includes(String(op.status).toLowerCase()))
      throw new HttpError(400, "Archived Pipeline cannot request support");
    if (!String(categoryId || "").trim() || !rows("support_types").some(
      (t) => t.support_type_id === categoryId && isActive(t.active)))
      throw new HttpError(400, "Select a valid Support Type");
    if (!String(note || "").trim()) throw new HttpError(400, "Support Note is required");
    const existing=supportRows().find((r) => r.opportunity_id===opportunityId &&
      r.status !== "Resolved");
    if (existing) return existing;
    const request={
      request_id:"SRQ-"+uuid(), opportunity_id:opportunityId, region_id:op.region_id,
      request_type_id:categoryId, note:String(note).slice(0,1000),
      status:"Open", requested_by_user_id:actor.real.id, assigned_to_user_id:"",
      response_note:"", created_at:stamp,updated_at:stamp,resolved_at:"",source:"user"
    };
    tableOf(supportBinding).rows.push(request);touch(supportBinding);
    return request;
  }
  function createSupport(actor,data) {
    const b=binding("Opportunity");need(actor,b,"update");
    const op=findRow(b,actor,String(data?.opportunity_id||""));
    const result=openSupportRequest(actor,op.opportunity_id,
      String(data?.request_type_id||""),data?.note,now());
    // Reflect the request in existing Pipeline and dashboard widgets.
    if(!bool.toUi(op.support_needed)){
      const before={...op};
      op.support_needed="Yes";op.support_type_id=result.request_type_id;
      op.support_note=result.note;op.updated_at=now();touch(b);
      appendAudit(op.opportunity_id,opportunityAuditEvents(before,op),actor,now());
    }
    return {...result};
  }
  function updateSupport(actor,id,data) {
    if (!supportBinding) throw new HttpError(503,"Support Requests need database setup");
    if (!["management","admin"].includes(actor.role))
      throw new HttpError(403,"Only Management or Admin can process support requests");
    const req=supportRows().find((r)=>r.request_id===id && supportVisible(actor,r));
    if (!req) throw new HttpError(404,"Support request not found");
    const desired=String(data?.status||req.status);
    if (!["Open","In Progress","Resolved"].includes(desired))
      throw new HttpError(400,"Invalid support status");
    if (req.status === "Resolved" && desired !== "Resolved")
      throw new HttpError(409,"Resolved request cannot be reopened; create a new request");
    if (desired === "Resolved" && !String(data?.response_note||req.response_note||"").trim())
      throw new HttpError(400,"Resolution note is required");
    const assignee=String(data?.assigned_to_user_id ?? req.assigned_to_user_id ?? "");
    if (assignee) {
      const user=findUser(assignee);
      if (!user || !["management","admin"].includes(user.role) ||
          (user.role==="management" && !user.region_ids.includes(req.region_id)))
        throw new HttpError(400,"Select an active Management assignee for the Region");
    }
    req.status=desired;req.assigned_to_user_id=assignee;
    req.response_note=String(data?.response_note ?? req.response_note ?? "").slice(0,1000);
    req.updated_at=now();
    if (desired==="Resolved" && !req.resolved_at) {
      req.resolved_at=now();
      const b=binding("Opportunity"),op=tableOf(b).rows.find((o)=>o.opportunity_id===req.opportunity_id);
      if (op && !supportRows().some((x)=>x!==req && x.opportunity_id===req.opportunity_id && x.status!=="Resolved")) {
        const before={...op};
        op.support_needed="No";op.support_type_id="";op.support_note="";
        op.updated_at=now();touch(b);
        appendAudit(op.opportunity_id,opportunityAuditEvents(before,op),actor,now());
      }
    }
    touch(supportBinding);
    return {...req};
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
  function validateOpportunityRefs(next, prev = null, actor = null) {
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
      if (!handler) throw new HttpError(400, "Current Handler must be an active user");
      // Existing escalation workflows may assign Management. AE cannot grant a
      // Management/Admin user customer-row access via an arbitrary handoff.
      if (["management", "admin"].includes(handler.role)) {
        if (actor?.role === "ae") throw new HttpError(403, "AE cannot hand off directly to Management or Admin");
        if (handler.role === "management" && !handler.region_ids.includes(String(next.region_id))) {
          throw new HttpError(400, "Management Handler is not assigned to this Pipeline's Region");
        }
      } else if (!["ae", "sm"].includes(handler.role) || !handler.region_ids.includes(String(next.region_id))) {
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
      if (uiEntity === "TeamMember" && !directoryVisible(actor, row.user_id)) {
        throw new HttpError(404, "Team member not found");
      }
      return visibleMember(actor, uiEntity, decorate(uiEntity, toUi(uiEntity, b.primary_key, row)));
    },
    create(uiEntity, actor, data, importMeta = null) {
      const b = binding(uiEntity);
      if (ENTITIES[uiEntity].virtual) return appConfigSet(actor, data.key, data.value);
      need(actor, b, "create");
      if (uiEntity === "OpportunityHistory" || uiEntity === "MonthlySnapshot") {
        throw new HttpError(403, "System-controlled entity; use the Pipeline or snapshot API");
      }
      if (uiEntity === "Stage") validateStageSla(data);
      if (uiEntity === "TeamMember") validateTeamMemberInput(data);
      const stamp = now();
      if (uiEntity === "Opportunity") {
        data = stripSystemFields(data);
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
          ...data, import_batch_id:importMeta.batchId,
          import_row_number:importMeta.rowNumber,
          import_row_signature:importMeta.signature,
        };
        // New Pipelines always start Open. Close them via the audited
        // Won/Lost update flow, which requires a Lost Reason when applicable.
        if (String(data.status || "open").toLowerCase() !== "open") {
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
        validateOpportunityRefs(row, null, actor);
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
        row.created_by_user_id = actor.real.id;
        validateCollaborators(row, row.region_id);
      }
      if (b.scoped && !scopedFilter(b, actor)(row)) throw new HttpError(403, `New ${b.sheet} row would be outside your scope`);
      const saved = fitColumns(b, row);
      tableOf(b).rows.push(saved);
      touch(b);
      if (uiEntity === "TeamMember") syncUserRegions(row[b.primary_key], data.region_ids);
      const auditEvents = b.entity === "opportunities"
        ? appendAudit(saved[b.primary_key], opportunityAuditEvents(null, saved), actor, stamp)
        : [];
      if (b.entity === "opportunities") addCreationNotifications(saved, actor, stamp);
      if (b.entity === "opportunities" && bool.toUi(saved.support_needed))
        openSupportRequest(actor,saved[b.primary_key],saved.support_type_id,saved.support_note,stamp);
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
      if (uiEntity === "Opportunity") {
        if (typeof expectedUpdatedAt !== "string") {
          throw new HttpError(428, "Pipeline revision is required. Refresh before saving.");
        }
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
          const allowed = new Set(["status", "remark", "last_remark", "audit_remark"]);
          for (const field of Object.keys(data)) {
            if (!allowed.has(field)) {
              throw new HttpError(409, "Reopen the Pipeline before editing " + field);
            }
          }
          if (desired === "open" && Object.keys(data).some((f) => f !== "status" && f !== "audit_remark")) {
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
        if (bool.toUi(next.support_needed) && !bool.toUi(row.support_needed)) {
          // The request will be committed in the same database transaction.
          openSupportRequest(actor,id,next.support_type_id,next.support_note,stamp);
        }
        if (!bool.toUi(next.support_needed) && bool.toUi(row.support_needed) &&
            supportBinding && supportRows().some((req) =>
              req.opportunity_id===id && req.status!=="Resolved"))
          throw new HttpError(409,"Resolve the active Support Request before disabling Support Needed");
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
      if (uiEntity === "OpportunityHistory" || uiEntity === "MonthlySnapshot") {
        throw new HttpError(403, "System-controlled entity");
      }
      // No UI needs bulk deletes. Never allow bypassing foreign-key checks,
      // Admin_Audit or app-owned data ownership rules via an empty filter.
      throw new HttpError(405, "Bulk deletion is disabled. Delete individual records with audit checks.");
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

    if (parts[0] === "notifications") {
      if (method === "GET" && parts.length === 1) return listNotifications(actor);
      if (method === "POST" && parts[2] === "read" && parts.length === 3)
        return readNotification(actor,parts[1]);
      throw new HttpError(405,"Notifications only support list and mark-read");
    }
    if (parts[0] === "support-requests") {
      if (method === "GET" && parts.length === 1) return listSupport(actor);
      if (method === "POST" && parts.length === 1) return createSupport(actor,req.body);
      if (method === "PATCH" && parts.length === 2) return updateSupport(actor,parts[1],req.body);
      throw new HttpError(405,"Unsupported Support Requests action");
    }

    if (parts[0] === "imports" && parts[1] === "opportunities") {
      if (method !== "POST") throw new HttpError(405, "Import requires POST");
      return importOpportunities(actor, req.body);
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
