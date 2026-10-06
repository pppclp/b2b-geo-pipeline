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

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isActive = (v) => v === "" || v == null || bool.toUi(v);

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
  const can = (role, rule, action) => (rule.permissions?.[action] || []).includes(role);
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
    return { id: u.user_id, name: u.display_name, email: u.email, role: u.role, region_ids: regionIdsFor(u.user_id) };
  }

  function actorFrom(userId, demoAs) {
    const real = findUser(userId);
    if (!real) throw new HttpError(401, "Not signed in");
    if (demoAs && demoAs !== real.id && (ac.demo_as_allowed_for || []).includes(real.role)) {
      const demo = findUser(demoAs);
      if (demo) return { ...demo, real };
    }
    return { ...real, real };
  }

  // ---- Row scope ----
  function scopeFn(actor) {
    const scope = ac.scope?.[actor.role] || "own";
    if (scope === "all") return () => true;
    if (scope === "region") {
      if (actor.role === "Management" && !actor.region_ids.length) return () => true;
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

  // ---- AppConfig: key/value view over Aging_Settings ----
  const CONFIG_DEFAULTS = { pipeline_value_metric: "pipeline_value", weighted_enabled: "true" };
  function agingRow() {
    return rows("pipeline_settings").find((r) => isActive(r.active) && r.threshold_days !== "") || rows("pipeline_settings")[0];
  }
  function appConfigList() {
    const aging = agingRow();
    return [
      { id: "aging_threshold_days", key: "aging_threshold_days", value: String(aging?.threshold_days ?? 14) },
      ...Object.entries(CONFIG_DEFAULTS).map(([key, value]) => ({ id: key, key, value, read_only: true })),
    ];
  }
  function appConfigSet(actor, key, value) {
    const b = bindings.pipeline_settings;
    need(actor, b, "update");
    if (key !== "aging_threshold_days") throw new HttpError(400, `${key} is not stored in the YAML contract (see business_decisions_pending)`);
    const row = agingRow();
    if (!row) throw new HttpError(404, "Aging_Settings has no rows");
    row.threshold_days = Number(value);
    touch(b);
    return appConfigList()[0];
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
      const stamp = now();
      const row = toSheet(uiEntity, b.primary_key, namesToIds(uiEntity, data));
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
      if (b.entity === "opportunities") row.created_by_user_id ||= actor.id;
      if (b.scoped && !scopedFilter(b, actor)(row)) throw new HttpError(403, `New ${b.sheet} row would be outside your scope`);
      const saved = fitColumns(b, row);
      tableOf(b).rows.push(saved);
      touch(b);
      if (uiEntity === "TeamMember") syncUserRegions(row[b.primary_key], data.region_ids);
      if (b.entity === "opportunities") outputs.refreshCurrent();
      else if (b.entity === "opportunity_events") outputs.logEvent(saved, actor);
      else if (!b.scoped) outputs.logMaster("CREATED", b, saved[b.primary_key], null, saved, actor);
      return decorate(uiEntity, toUi(uiEntity, b.primary_key, row));
    },
    update(uiEntity, actor, id, data) {
      const b = binding(uiEntity);
      if (ENTITIES[uiEntity].virtual) return appConfigSet(actor, id, data.value);
      need(actor, b, "update");
      const row = findRow(b, actor, id);
      const before = { ...row };
      const changes = toSheet(uiEntity, b.primary_key, namesToIds(uiEntity, data));
      delete changes[b.primary_key];
      Object.assign(row, fitColumns(b, { ...changes, updated_at: now() }));
      touch(b);
      if (uiEntity === "TeamMember") syncUserRegions(id, data.region_ids);
      if (b.entity === "opportunities") outputs.refreshCurrent();
      else if (!b.scoped) outputs.logMaster("UPDATED", b, id, before, row, actor);
      return decorate(uiEntity, toUi(uiEntity, b.primary_key, row));
    },
    remove(uiEntity, actor, id) {
      const b = binding(uiEntity);
      need(actor, b, "delete");
      const row = findRow(b, actor, id);
      assertNotReferenced(b, id);
      const t = tableOf(b);
      t.rows = t.rows.filter((r) => r !== row);
      touch(b);
      if (b.entity === "opportunities") outputs.refreshCurrent();
      else if (!b.scoped) outputs.logMaster("DELETED", b, id, row, null, actor);
      return { ok: true };
    },
    removeMany(uiEntity, actor, query) {
      const b = binding(uiEntity);
      need(actor, b, "delete");
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

    // Dev sign-in list. Replace with real authentication before UAT.
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
      return { role: actor.role, scope: ac.scope?.[actor.role], allowed };
    }

    if (parts[0] === "entities" && parts[1]) {
      const [, entity, id] = parts;
      if (method === "GET" && !id) return entityApi.list(entity, actor, { sort: query.sort, limit: query.limit, query: q });
      if (method === "GET") return entityApi.get(entity, actor, id);
      if (method === "POST" && id === "bulk") {
        const created = (req.body || []).map((item) => entityApi.create(entity, actor, item));
        if (entity === "MonthlySnapshot" && created[0]) outputs.monthEnd(created[0].snapshot_month);
        return created;
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
