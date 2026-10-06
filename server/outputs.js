// Output sheets: the three *_Export_Template files are written by the backend
// and never read back as data (YAML: "Export files are OUTPUT only").
// Which sheets are written is declared in access_control.files.<file>.output.
// Row builders follow the template headers; columns the template computes
// with formulas (event_month, aging, weighted value…) are written as values.
//
// Synchronous and Node-free, like core.js.

// UI event_type (+ field) -> Event_Type_Reference in the Change Log template.
const EVENT_TYPES = {
  create: ["OPPORTUNITY_CREATED", "opportunity_id"],
  stage_change: ["STAGE_CHANGED", "stage_id"],
  handler_change: ["HANDLER_CHANGED", "current_handler_user_id"],
  close_month_change: ["EXPECTED_CLOSE_CHANGED", "expected_close_month"],
  working_with_change: ["WORKING_WITH_CHANGED", "working_with_id"],
  support_on: ["SUPPORT_RAISED", "support_needed"],
  support_off: ["SUPPORT_CLEARED", "support_needed"],
  status_change: ["STATUS_CHANGED", "status"],
  won: ["WON", "status"],
  lost: ["LOST", "status"],
  archived: ["ARCHIVED", "status"],
};

const MS_DAY = 86400000;
const month = (iso) => (iso ? String(iso).slice(0, 7) : "");
const days = (from, to) => {
  const a = Date.parse(from), b = Date.parse(to);
  return isNaN(a) || isNaN(b) ? "" : Math.max(0, Math.floor((b - a) / MS_DAY));
};
const flag = (v) => v === true || ["YES", "TRUE", "Y", "1"].includes(String(v).trim().toUpperCase());

export function createOutputs({ contract, store, rows, now, uuid, log = () => {} }) {
  // sheet name -> { file, mode }
  const targets = {};
  for (const [file, f] of Object.entries(contract.access.files)) {
    for (const [sheet, cfg] of Object.entries(f.output || {})) targets[sheet] = { file, ...cfg };
  }

  const index = (entity, key) => Object.fromEntries(rows(entity).map((r) => [String(r[key]), r]));
  function lookups() {
    return {
      user: index("users", "user_id"),
      region: index("regions", "region_id"),
      territory: index("territories", "territory_id"),
      product: index("products", "product_id"),
      category: index("product_categories", "category_id"),
      stage: index("stages", "stage_id"),
      scenario: index("scenarios", "scenario_id"),
      team: index("working_with_options", "team_id"),
      support: index("support_types", "support_type_id"),
      reason: index("lost_reasons", "reason_id"),
    };
  }
  const name = (map, id, col) => (id && map[String(id)] ? map[String(id)][col] : "");

  // Each output is best-effort: a failure is logged, never blocks the user's action.
  function safely(label, fn) {
    try {
      fn();
    } catch (e) {
      log(`[outputs] ${label} failed: ${e.message}`);
    }
  }

  // Keep the template's columns: drop builder fields the template doesn't have.
  const fit = (headers, list) => (headers.length ? list.map((r) => Object.fromEntries(headers.map((h) => [h, r[h] ?? ""]))) : list);

  function replace(sheet, newRows) {
    const t = targets[sheet];
    if (!t) return;
    const table = store.table(t.file, sheet);
    if (!table.headers.length && newRows[0]) table.headers = Object.keys(newRows[0]);
    table.rows = fit(table.headers, newRows);
    store.touch(t.file, sheet);
  }

  function append(sheet, newRows) {
    const t = targets[sheet];
    if (!t || !newRows.length) return;
    if (store.append) return store.append(t.file, sheet, newRows); // Apps Script: no full read
    const table = store.table(t.file, sheet);
    if (!table.headers.length) table.headers = Object.keys(newRows[0]);
    table.rows.push(...fit(table.headers, newRows));
    store.touch(t.file, sheet);
  }

  function opportunityBase(o, L) {
    const product = L.product[String(o.product_id)];
    const categoryId = product?.category_id || o.product_category_id || "";
    return {
      opportunity_id: o.opportunity_id,
      customer_name: o.customer_name,
      business_id: o.business_id,
      region_id: o.region_id,
      region_name: name(L.region, o.region_id, "region_name"),
      territory_id: o.territory_id,
      territory_name: name(L.territory, o.territory_id, "territory_name"),
      owner_user_id: o.owner_user_id,
      owner_name: name(L.user, o.owner_user_id, "display_name"),
      current_handler_user_id: o.current_handler_user_id,
      current_handler_name: name(L.user, o.current_handler_user_id, "display_name"),
      category_id: categoryId,
      category_name: name(L.category, categoryId, "category_name"),
      product_id: o.product_id,
      product_name: product?.product_name || "",
      stage_id: o.stage_id,
      stage_name: name(L.stage, o.stage_id, "stage_name"),
      pipeline_value: o.pipeline_value === "" ? "" : Number(o.pipeline_value) || 0,
      expected_close_month: o.expected_close_month,
      created_at: o.created_at,
      created_month: o.created_month || month(o.created_at),
    };
  }

  // ---- Current_Pipeline_Export: one row per opportunity, regenerated ----
  function refreshCurrent() {
    if (!targets.Current_Pipeline_Export) return;
    safely("Current_Pipeline_Export", () => {
      const L = lookups();
      const at = now();
      replace(
        "Current_Pipeline_Export",
        rows("opportunities").map((o) => {
          const weight = Number(name(L.stage, o.stage_id, "weight_pct")) || 0;
          return {
            ...opportunityBase(o, L),
            customer_type: o.customer_type,
            scenario_id: o.scenario_id,
            scenario_name: name(L.scenario, o.scenario_id, "scenario_name"),
            original_owner_user_id: o.original_owner_user_id,
            original_owner_name: name(L.user, o.original_owner_user_id, "display_name"),
            quantity: o.quantity,
            rc: o.rc,
            oc: o.oc,
            discount_pct: o.discount_pct,
            contract_period_months: o.contract_period_months,
            stage_weight_pct: weight,
            weighted_pipeline_value: (Number(o.pipeline_value) || 0) * weight / 100,
            status: o.status,
            created_by_user_id: o.created_by_user_id,
            created_by_name: name(L.user, o.created_by_user_id, "display_name"),
            updated_at: o.updated_at,
            stage_entered_at: o.stage_entered_at,
            stage_aging_days: days(o.stage_entered_at, at),
            handler_since: o.handler_since,
            handler_aging_days: days(o.handler_since, at),
            working_with_id: o.working_with_id,
            working_with_name: name(L.team, o.working_with_id, "team_name"),
            working_with_since: o.working_with_since,
            working_with_aging_days: o.working_with_id ? days(o.working_with_since, at) : "",
            support_needed: flag(o.support_needed),
            support_type_id: o.support_type_id,
            support_type_name: name(L.support, o.support_type_id, "support_type_name"),
            support_note: o.support_note,
            won_at: o.won_at,
            won_by_user_id: o.won_by_user_id,
            won_by_name: name(L.user, o.won_by_user_id, "display_name"),
            lost_at: o.lost_at,
            lost_by_user_id: o.lost_by_user_id,
            lost_by_name: name(L.user, o.lost_by_user_id, "display_name"),
            lost_reason_id: o.lost_reason_id,
            lost_reason_name: name(L.reason, o.lost_reason_id, "reason_name"),
            lost_note: o.lost_note,
            exported_at: at,
          };
        })
      );
    });
  }

  // ---- Change_Log_Export: append-only audit trail ----
  function actorFields(actor) {
    return { actor_user_id: actor.real.id, actor_name: actor.real.name, actor_role: actor.real.role };
  }

  // Resolve a display value back to its ID for the template's *_value_id columns.
  function valueId(field, value, L) {
    if (!value) return "";
    const byName = (map, col) => Object.values(map).find((r) => r[col] === value);
    if (field === "stage_id") return byName(L.stage, "stage_name")?.stage_id || "";
    if (field === "current_handler_user_id" || field === "owner_user_id") return byName(L.user, "display_name")?.user_id || "";
    if (field === "working_with_id") return byName(L.team, "team_name")?.team_id || "";
    if (field === "expected_close_month" || field === "status") return value;
    return "";
  }

  function logEvent(event, actor) {
    if (!targets.Change_Log_Export) return;
    safely("Change_Log_Export", () => {
      const L = lookups();
      const o = rows("opportunities").find((r) => r.opportunity_id === event.opportunity_id) || {};
      let [type, field] = EVENT_TYPES[event.event_type] || [String(event.event_type || "").toUpperCase(), event.field_name];
      if (event.event_type === "reassign") [type, field] = event.field_name === "owner" ? ["OWNER_CHANGED", "owner_user_id"] : ["HANDLER_CHANGED", "current_handler_user_id"];
      const base = opportunityBase(o, L);
      // Status values use the sheet's Title case (Open → Won), as in the template.
      const title = (v) => (field === "status" && v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : v);
      event = { ...event, previous_value: title(event.previous_value), new_value: title(event.new_value) };
      append("Change_Log_Export", [
        {
          event_id: event.event_id,
          opportunity_id: event.opportunity_id,
          customer_name: base.customer_name,
          business_id: base.business_id,
          region_id: base.region_id,
          region_name: base.region_name,
          owner_user_id: base.owner_user_id,
          owner_name: base.owner_name,
          event_type: type,
          field_name: field,
          previous_value_id: valueId(field, event.previous_value, L),
          previous_value: event.previous_value,
          new_value_id: type === "OPPORTUNITY_CREATED" ? event.opportunity_id : valueId(field, event.new_value, L),
          new_value: event.new_value,
          ...actorFields(actor),
          event_at: event.event_at,
          event_month: month(event.event_at),
          remark: event.remark,
          source: "Web App",
          exported_at: now(),
        },
      ]);
    });
  }

  // Master data edits (Admin) — one row per changed column.
  function logMaster(kind, b, id, before, after, actor) {
    if (!targets.Change_Log_Export) return;
    safely("Change_Log_Export (master)", () => {
      const at = now();
      const cols =
        kind === "UPDATED"
          ? Object.keys(after).filter((k) => !["updated_at", "created_at"].includes(k) && String(before?.[k] ?? "") !== String(after[k] ?? ""))
          : [b.primary_key];
      append(
        "Change_Log_Export",
        cols.map((col, i) => ({
          event_id: `ADM-${uuid().slice(0, 8).toUpperCase()}`,
          event_type: `MASTER_${kind}`,
          field_name: `${b.sheet}.${col}`,
          previous_value_id: kind === "CREATED" ? "" : id,
          previous_value: kind === "CREATED" ? "" : String(before?.[col] ?? ""),
          new_value_id: kind === "DELETED" ? "" : id,
          new_value: kind === "DELETED" ? "" : String(after?.[col] ?? ""),
          ...actorFields(actor),
          event_at: at,
          event_month: month(at),
          remark: `${b.file} / ${b.sheet} / ${id}`,
          source: "Admin",
          exported_at: at,
        }))
      );
    });
  }

  // ---- Month-end workbook: latest captured month ----
  function monthEnd(snapshotMonth) {
    if (!snapshotMonth) return;
    safely("Month-end export", () => {
      const L = lookups();
      const at = now();
      const [y, m] = snapshotMonth.split("-").map(Number);
      const monthEndIso = new Date(Date.UTC(y, m, 0, 23, 59, 59)).toISOString();
      const opps = index("opportunities", "opportunity_id");

      replace(
        "Open_Pipeline_Snapshot",
        rows("monthly_snapshots")
          .filter((s) => s.snapshot_month === snapshotMonth && String(s.status).toLowerCase() === "open")
          .map((s) => {
            const o = { ...(opps[String(s.opportunity_id)] || {}), ...s };
            const weight = Number(name(L.stage, s.stage_id, "weight_pct")) || 0;
            return {
              snapshot_id: s.snapshot_id,
              snapshot_month: s.snapshot_month,
              ...opportunityBase(o, L),
              stage_weight_pct: weight,
              status: s.status,
              weighted_pipeline_value: (Number(s.pipeline_value) || 0) * weight / 100,
              stage_entered_at: o.stage_entered_at,
              stage_aging_days: days(o.stage_entered_at, monthEndIso),
              handler_since: o.handler_since,
              handler_aging_days: days(o.handler_since, monthEndIso),
              working_with_id: o.working_with_id,
              working_with_name: name(L.team, o.working_with_id, "team_name"),
              support_needed: flag(s.support_needed),
              support_type_name: name(L.support, o.support_type_id, "support_type_name"),
              snapshot_created_at: at,
            };
          })
      );

      const closed = (status, atCol) =>
        rows("opportunities")
          .filter((o) => String(o.status).toLowerCase() === status && month(o[atCol]) === snapshotMonth)
          .map((o) => ({ ...opportunityBase(o, L), exported_at: at, o }));

      replace(
        "Closed_Won",
        closed("won", "won_at").map(({ o, ...r }) => ({
          ...r,
          won_at: o.won_at,
          won_month: month(o.won_at),
          won_by_user_id: o.won_by_user_id,
          won_by_name: name(L.user, o.won_by_user_id, "display_name"),
          days_from_creation_to_win: days(o.created_at, o.won_at),
        }))
      );
      replace(
        "Closed_Lost",
        closed("lost", "lost_at").map(({ o, ...r }) => ({
          ...r,
          lost_at: o.lost_at,
          lost_month: month(o.lost_at),
          lost_by_user_id: o.lost_by_user_id,
          lost_by_name: name(L.user, o.lost_by_user_id, "display_name"),
          lost_reason_id: o.lost_reason_id,
          lost_reason_name: name(L.reason, o.lost_reason_id, "reason_name"),
          lost_note: o.lost_note,
          days_from_creation_to_lost: days(o.created_at, o.lost_at),
        }))
      );

      // Summary is a formula layout: only its Reporting Month / Generated At cells are set.
      const summary = targets.Summary;
      if (summary && store.setCell) {
        store.setCell(summary.file, "Summary", "B3", snapshotMonth);
        store.setCell(summary.file, "Summary", "B5", at);
      }
    });
  }

  return { refreshCurrent, logEvent, logMaster, monthEnd, targets };
}
