// Create audit events from *server-confirmed* state changes, never client-authored history.
const IGNORED = new Set([
  "created_at", "updated_at", "created_by_user_id", "created_month",
  "stage_entered_at", "handler_since", "working_with_since",
  "won_at", "won_by_user_id", "lost_at", "lost_by_user_id", "archived_at",
]);
const CHANGES = {
  stage_id: ["stage_change", "stage"],
  current_handler_user_id: ["handler_change", "current_handler"],
  owner_user_id: ["reassign", "owner"],
  working_with_id: ["working_with_change", "working_with"],
  expected_close_month: ["close_month_change", "expected_close_month"],
};

function visible(value) {
  if (value == null) return "";
  return typeof value === "boolean" ? (value ? "On" : "Off") : String(value);
}

export function opportunityAuditEvents(before, after, { remark = "" } = {}) {
  if (!before) return [{
    event_type: "create",
    field: "opportunity_id",
    previous_value: "",
    new_value: visible(after.opportunity_id),
    remark: "",
  }];
  const changes = [];
  for (const field of Object.keys(after)) {
    if (IGNORED.has(field) || field === "opportunity_id") continue;
    if (visible(before[field]) === visible(after[field])) continue;
    let [event_type, auditField] = CHANGES[field] || ["field_change", field];
    if (field === "status") {
      const status = visible(after.status).toLowerCase();
      event_type = ["won", "lost", "archived"].includes(status) ? status : "status_change";
      auditField = "status";
    } else if (field === "support_needed") {
      event_type = visible(after[field]) === "On" || ["yes", "true"].includes(visible(after[field]).toLowerCase()) ? "support_on" : "support_off";
      auditField = "support_needed";
    }
    changes.push({
      event_type,
      field: auditField,
      previous_value: visible(before[field]),
      new_value: visible(after[field]),
      remark: String(remark || "").slice(0, 500),
    });
  }
  return changes;
}
