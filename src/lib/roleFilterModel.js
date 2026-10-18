import { fieldChoices } from "./configChoices.js";

// Read-only presentation metadata for the Pipeline page.
// Filter values are derived from *server-scoped* opportunities, never a global
// User Master list; authorization remains entirely on the backend.
export const ROLE_FILTERS = Object.freeze({
  ae: {
    primary: ["status", "close_month", "created_month", "stage"],
    more: ["product_category", "sales_channel", "support", "stuck", "internal_overdue"],
  },
  sm: {
    primary: ["status", "close_month", "created_month", "stage", "owner", "region"],
    more: ["handler", "product_category", "sales_channel", "working_with", "scenario",
      "ccp_check_result", "needs_review", "support", "stuck", "internal_overdue"],
  },
  management: {
    primary: ["status", "close_month", "created_month", "stage", "region", "owner", "product_category", "sales_channel"],
    more: ["handler", "working_with", "scenario", "ccp_check_result",
      "support", "stuck", "internal_overdue"],
  },
  admin: {
    primary: ["status", "close_month", "created_month", "stage", "region", "owner", "product_category", "sales_channel"],
    more: ["handler", "working_with", "scenario", "ccp_check_result", "needs_review",
      "support", "stuck", "internal_overdue"],
  },
});

export const FILTER_LABELS = Object.freeze({
  status: "Status", close_month: "เดือนปิดคาดการณ์", created_month: "เดือนที่สร้าง",
  stage: "Stage", owner: "AE เจ้าของ Pipeline", handler: "ผู้รับผิดชอบปัจจุบัน", region: "Region",
  product_category: "Product Category", sales_channel: "ช่องทางขาย",
  working_with: "ทำงานร่วมกับ", scenario: "Scenario", ccp_check_result: "CCP+ Check",
  support: "ต้องการ Support", stuck: "เกิน Stage SLA", internal_overdue: "เกิน Internal SLA",
  needs_review: "รอ SM Review",
});

const optionFields = Object.freeze({
  region: ["region_id", "region"],
  owner: ["owner_id", "member"],
  handler: ["current_handler_id", "member"],
  stage: ["stage_id", "stage"],
  product_category: ["product_category_id", "category"],
  sales_channel: ["sales_channel", null],
  scenario: ["scenario_id", "scenario"],
  ccp_check_result: ["ccp_check_result", null],
  working_with: ["working_with", "workingWith"],
});

export function visibleFilterFields(role, regionIds = []) {
  const layout = ROLE_FILTERS[role] || ROLE_FILTERS.ae;
  // SMs assigned to one Region should not need a Region selector; unlike
  // other fields, this is an actual permission-scoped structural invariant.
  const showRegion = role !== "sm" || new Set(regionIds).size > 1;
  return {
    primary: layout.primary.filter((key) => key !== "region" || showRegion),
    more: layout.more,
  };
}

// Configuration-driven selection: labels/allowed values come from the existing
// Pipeline Config and Product Master. Owner/Region/Handler are intersected with
// IDs already present in the server-authorized Pipeline list.
const CONFIG_MASTERS = {
  stage: "Stage",
  scenario: "Scenario",
  working_with: "WorkingWithOption",
  product_category: "ProductCategory",
};
const FIELD_OPTION_KEYS = {
  sales_channel: "sales_channel",
  ccp_check_result: "ccp_check_result",
};
export function optionsFromVisiblePipelines(key, scopedOpportunities, maps = {}, master = {}) {
  const spec = optionFields[key];
  if (!spec) return [];
  const [field, mapKey] = spec;
  const rows = scopedOpportunities || [];
  const existing = [...new Set(rows.map((op) => op[field])
    .filter((value) => value !== "" && value !== null && value !== undefined).map(String))];
  const idLabel = (value) => String((mapKey && maps[mapKey]?.[value]?.name) || value);
  const masterKey = CONFIG_MASTERS[key];
  if (masterKey) {
    const list = (master?.[masterKey] || []).filter((item) => item.active);
    if (list.length) {
      const options = list.map((item) => ({
        value: String(item.id), label: String(item.name || item.id), order: Number(item.order ?? 9999),
      })).sort((a,b)=>a.order-b.order || a.label.localeCompare(b.label))
        .map(({value,label})=>({value,label}));
      // Preserve historical/retired references while avoiding meaningless master
      // values from other users: append only values present in scoped records.
      for (const value of existing) {
        if (!options.some((item)=>item.value===value)) options.push({value,label:idLabel(value)});
      }
      return options;
    }
  }
  const fieldKey = FIELD_OPTION_KEYS[key];
  if (fieldKey) {
    const options = fieldChoices(master, fieldKey);
    if (options.length) {
      for (const value of existing) {
        if (!options.some((item)=>item.value===value)) options.push({value,label:value});
      }
      return options;
    }
  }
  // Older backend deployment may not yet expose FieldOption. Fallback is
  // read-only values already in authorized data, never a fabricated list.
  return existing.map((value)=>({value,label:idLabel(value)}))
    .sort((a,b)=>a.label.localeCompare(b.label));
}

export function roleOwnershipMatches(op, userId, view) {
  if (!view || view === "all") return true;
  if (!userId) return false;
  if (view === "mine") return op.owner_id === userId; // Commercial owner, even after handoff
  if (view === "sent") return op.owner_id === userId && op.current_handler_id !== userId;
  if (view === "received") return op.current_handler_id === userId && op.owner_id !== userId;
  return false;
}

export function isPendingSmReview(op) {
  return !op.scenario_id || !op.ccp_check_result || op.ccp_check_result === "pending";
}

export function normalizeFilterSelection(key, selected) {
  // Status 'all' is the all-statuses view; for other dropdowns it means clear.
  return selected === "all" && key !== "status" ? "" : selected;
}

export function isFilterActive(key, value) {
  // "All statuses" differs from the default Open view and is resettable.
  if (key === "status") return value !== "" && value != null && value !== "open";
  return value !== "" && value != null && value !== "all";
}
