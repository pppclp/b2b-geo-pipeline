// B2B GEO Pipeline: only approved business fields may be persisted.
// This list is intentionally independent of existing Sheet headers: an
// accidental or injected spreadsheet column must not become API-writable.
export const OPPORTUNITY_COLUMNS = new Set([
  "opportunity_id", "customer_name", "business_id", "customer_type",
  "sales_channel", "partner_name", "contact_name", "contact_phone", "remark",
  "product_category_id", "product_details", "quantity", "price_per_sub", "oc",
  "contract_period_months", "pipeline_value", "expected_close_month",
  "scenario_id", "ccp_check_result", "region_id", "territory_id",
  "original_owner_user_id", "owner_user_id", "current_handler_user_id",
  "stage_id", "status", "created_at", "updated_at", "created_month",
  "created_by_user_id", "stage_entered_at", "handler_since",
  "working_with_id", "working_with_since", "support_needed",
  "support_type_id", "support_note", "won_at", "won_by_user_id",
  "lost_at", "lost_by_user_id", "lost_reason_id", "lost_note",
  "archived_at", "working_with_team_ids", "working_with_user_ids", "import_batch_id", "import_row_number", "import_row_signature", "client_request_id",
  // Import-only provenance: never merge legacy RC/discount/product ID into live pricing.
  "import_source_system", "import_source_record_id", "import_source_product_id", "import_source_rc",
  "import_source_discount_pct", "import_source_monthly_sale_plan", "import_source_net_rc",
  "import_source_customer_type", "customer_location_text",
]);

// UI names AND sheet names of fields the browser must never control.
// Backend closure handling supplies won/lost attribution and timestamps.
export const SYSTEM_OPPORTUNITY_FIELDS = new Set([
  "id", "opportunity_id", "created_date", "created_at", "updated_date",
  "updated_at", "created_month", "created_by_user_id",
  "original_owner_id", "original_owner_user_id",
  "stage_entered_at", "handler_since", "working_with_since",
  "won_at", "won_by", "won_by_user_id",
  "lost_at", "lost_by", "lost_by_user_id", "archived_at",
  "source_created_month", "source_created_at", "source_stage_entered_at", "source_closed_at",
  "source_system", "source_record_id", "source_sales_code", "source_customer_type", "source_product_id", "source_rc", "source_discount_pct",
  "source_monthly_sale_plan", "reference_net_rc",
  "import_source_system", "import_source_record_id", "import_source_product_id", "import_source_rc",
  "import_source_discount_pct", "import_source_monthly_sale_plan", "import_source_net_rc",
  "import_source_customer_type", "import_batch_id", "import_row_number", "import_row_signature",
]);

export function stripSystemFields(data) {
  return Object.fromEntries(
    Object.entries(data || {}).filter(([key]) => !SYSTEM_OPPORTUNITY_FIELDS.has(key))
  );
}

export function keepOpportunityColumns(row) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => OPPORTUNITY_COLUMNS.has(key))
  );
}

export const isMonthKey = (value) =>
  typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export function bangkokMonth(isoTimestamp) {
  const ms = Date.parse(isoTimestamp);
  if (!Number.isFinite(ms)) throw new Error("Invalid timestamp");
  // Thailand has no DST. Use a fixed UTC+07:00 for business month boundaries.
  return new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 7);
}
