// Maps the entity names the UI uses (inherited from the Base44 prototype)
// to the YAML entities / sheet columns in b2b_geo_pipeline.yaml.
// Which file + sheet backs an entity, and who may touch it, comes from
// `access_control` in the YAML — this file only translates field names.

// Source sheets use Yes / No for flags.
export const bool = {
  toUi: (v) => v === true || v === 1 || ["YES", "Y", "TRUE", "1"].includes(String(v).trim().toUpperCase()),
  toSheet: (v) => (v ? "Yes" : "No"),
};

const lower = {
  toUi: (v) => (v == null || v === "" ? v : String(v).toLowerCase()),
  toSheet: (v) => (v == null || v === "" ? v : String(v).charAt(0).toUpperCase() + String(v).slice(1)),
};

const role = {
  toUi: (v) => (v ? String(v).toLowerCase() : "ae"),
  toSheet: (v) => ({ ae: "AE", sm: "SM", management: "Management", admin: "Admin" }[String(v).toLowerCase()] || v),
};

const activeStatus = {
  toUi: (v) => String(v || "Active").toLowerCase() === "active",
  toSheet: (v) => (v ? "Active" : "Inactive"),
};

const list = {
  toUi: (v) => (v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : []),
  toSheet: (v) => (Array.isArray(v) ? v.join(",") : v || ""),
};

const number = {
  toUi: (v) => (v === "" || v == null ? null : Number(v)),
  toSheet: (v) => (v === "" || v == null ? null : Number(v)),
};

// uiField -> sheet column (string) or { col, toUi, toSheet }.
// Unlisted UI fields are stored in a column of the same name.
export const ENTITIES = {
  TeamMember: {
    entity: "users",
    idPrefix: "USR",
    fields: {
      name: "display_name",
      email: "email",
      app_role: { col: "role", ...role },
      active: { col: "status", ...activeStatus },
      territory_ids: { col: "territory_ids", ...list },
      // region_ids is derived from User_Region (see api.js)
    },
  },
  Region: {
    entity: "regions",
    idPrefix: "REG",
    fields: { name: "region_name", order: { col: "sort_order", ...number }, active: { col: "active", ...bool } },
  },
  Territory: {
    entity: "territories",
    idPrefix: "TER",
    fields: { name: "territory_name", region_id: "region_id", active: { col: "active", ...bool } },
  },
  ProductCategory: {
    entity: "product_categories",
    idPrefix: "CAT",
    fields: { name: "category_name", order: { col: "sort_order", ...number }, active: { col: "active", ...bool } },
  },
  Product: {
    entity: "products",
    idPrefix: "PRD",
    fields: {
      name: "product_name",
      category_id: "category_id",
      order: { col: "sort_order", ...number },
      active: { col: "active", ...bool },
    },
  },
  Stage: {
    entity: "stages",
    idPrefix: "STG",
    fields: {
      name: "stage_name",
      order: { col: "sort_order", ...number },
      weight: { col: "weight_pct", ...number },
      active: { col: "active", ...bool },
    },
  },
  Scenario: {
    entity: "scenarios",
    idPrefix: "SCN",
    fields: { name: "scenario_name", order: { col: "sort_order", ...number }, active: { col: "active", ...bool } },
  },
  LostReason: {
    entity: "lost_reasons",
    idPrefix: "LRS",
    fields: { name: "reason_name", order: { col: "sort_order", ...number }, active: { col: "active", ...bool } },
  },
  WorkingWithOption: {
    entity: "working_with_options",
    idPrefix: "TEAM",
    fields: { name: "team_name", order: { col: "sort_order", ...number }, active: { col: "active", ...bool } },
  },
  SupportType: {
    entity: "support_types",
    idPrefix: "SUP",
    fields: { name: "support_type_name", order: { col: "sort_order", ...number }, active: { col: "active", ...bool } },
  },
  AppConfig: {
    // Virtual key/value view over Aging_Settings (see appConfig in core.js).
    entity: "pipeline_settings",
    virtual: true,
    fields: {},
  },
  Opportunity: {
    entity: "opportunities",
    idPrefix: "OPP",
    fields: {
      owner_id: "owner_user_id",
      original_owner_id: "original_owner_user_id",
      current_handler_id: "current_handler_user_id",
      working_with: "working_with_id",
      support_type: "support_type_id",
      won_by: "won_by_user_id",
      lost_by: "lost_by_user_id",
      discount: { col: "discount_pct", ...number },
      contract_period: { col: "contract_period_months", ...number },
      status: { col: "status", ...lower },
      support_needed: { col: "support_needed", ...bool },
      pipeline_value: { col: "pipeline_value", ...number },
      quantity: { col: "quantity", ...number },
      rc: { col: "rc", ...number },
      oc: { col: "oc", ...number },
    },
  },
  OpportunityHistory: {
    entity: "opportunity_events",
    idPrefix: "EVT",
    fields: { actor_id: "actor_user_id", field: "field_name", created_date: "event_at" },
  },
  MonthlySnapshot: {
    entity: "monthly_snapshots",
    idPrefix: "SNP",
    fields: {
      owner_id: "owner_user_id",
      current_handler_id: "current_handler_user_id",
      status: { col: "status", ...lower },
      support_needed: { col: "support_needed", ...bool },
      pipeline_value: { col: "pipeline_value", ...number },
    },
  },
};

const spec = (f) => (typeof f === "string" ? { col: f } : f);

export function toUi(uiEntity, pk, row) {
  const def = ENTITIES[uiEntity];
  const out = {};
  const mappedCols = new Set([pk]);
  for (const [uiField, f] of Object.entries(def.fields)) {
    const s = spec(f);
    mappedCols.add(s.col);
    const raw = row[s.col];
    out[uiField] = s.toUi ? s.toUi(raw) : raw ?? "";
  }
  for (const [col, v] of Object.entries(row)) {
    if (mappedCols.has(col)) continue;
    if (col === "created_at") out.created_date = v;
    else if (col === "updated_at") out.updated_date = v;
    else out[col] = v;
  }
  out.id = row[pk];
  return out;
}

export function toSheet(uiEntity, pk, data) {
  const def = ENTITIES[uiEntity];
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === "id" || k === "region_ids") continue;
    const f = def.fields[k];
    if (f) {
      const s = spec(f);
      out[s.col] = s.toSheet ? s.toSheet(v) : v;
    } else if (k === "created_date") out.created_at = v;
    else if (k === "updated_date") out.updated_at = v;
    else out[k] = Array.isArray(v) ? v.join(",") : v;
  }
  return out;
}

export function sheetCol(uiEntity, uiField) {
  const f = ENTITIES[uiEntity]?.fields[uiField];
  if (f) return spec(f).col;
  if (uiField === "created_date") return "created_at";
  return uiField;
}
