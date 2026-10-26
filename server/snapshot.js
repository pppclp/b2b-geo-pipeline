// Controlled, server-side month-end capture. The client supplies only YYYY-MM.
export function snapshotPeriodValid(period) {
  if (typeof period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return false;
  return true;
}
export function buildSnapshotRows(opportunities, snapshotPeriod, capturedAt, newId, usersById = new Map()) {
  if (!snapshotPeriodValid(snapshotPeriod)) throw new Error("Snapshot period must be YYYY-MM");
  const ids = new Set();
  return opportunities.filter((o) => ["open", "won", "lost"].includes(String(o.status || "").toLowerCase()))
    .map((o) => {
      if (!o.opportunity_id || ids.has(String(o.opportunity_id))) throw new Error("Duplicate or missing Pipeline ID in snapshot source");
      ids.add(String(o.opportunity_id));
      const months = o.contract_period_months === "" || o.contract_period_months == null ? null : Number(o.contract_period_months);
      // Freeze the identity label visible to business users at capture time.
      // Historical spreadsheet spellings are advisory; Users Master owns AE identity.
      const owner = usersById.get(String(o.owner_user_id || "")) || null;
      const netRc = Number(o.pipeline_value || 0);
      if (!Number.isFinite(netRc) || (months !== null && !Number.isFinite(months))) throw new Error("Invalid Pipeline financial data for snapshot");
      return {
        snapshot_id: newId(),
        snapshot_period: snapshotPeriod,
        captured_at: capturedAt,
        opportunity_id: o.opportunity_id,
        lead_created_at: o.created_at || "",
        owner_user_id: o.owner_user_id || "",
        current_handler_user_id: o.current_handler_user_id || "",
        region_id: o.region_id || "",
        territory_id: o.territory_id || "",
        sales_channel: o.sales_channel || "",
        partner_name: o.partner_name || "",
        business_id: o.business_id || "",
        customer_name: o.customer_name || "",
        customer_type: o.customer_type || "",
        contact_name: o.contact_name || "",
        contact_phone: o.contact_phone || "",
        remark: o.remark || "",
        product_category_id: o.product_category_id || "",
        product_details: o.product_details || "",
        quantity: o.quantity ?? "",
        price_per_sub: o.price_per_sub ?? "",
        pipeline_value: netRc,
        oc: o.oc ?? "",
        contract_period_months: months ?? "",
        contract_value: months === null ? "" : netRc * months,
        expected_close_month: o.expected_close_month || "",
        ccp_check_result: o.ccp_check_result || "",
        scenario_id: o.scenario_id || "",
        handoff_at: o.current_handler_user_id && o.current_handler_user_id !== o.owner_user_id ? (o.handler_since || "") : "",
        stage_id: o.stage_id || "",
        stage_last_updated_at: o.stage_entered_at || "",
        status: o.status || "",
        support_needed: o.support_needed || "",
        support_type_id: o.support_type_id || "",
        support_note: o.support_note || "",
        won_at: o.won_at || "",
        lost_at: o.lost_at || "",
        lost_reason_id: o.lost_reason_id || "",
        // Import-friendly evidence. Append fields; never shift historical columns.
        created_month: o.created_month || "",
        owner_sales_code: owner?.employee_id == null ? "" : String(owner.employee_id),
        owner_sale_name: owner?.display_name || "",
        customer_location_text: o.customer_location_text || "",
        import_source_customer_type: o.import_source_customer_type || "",
        import_source_rc: o.import_source_rc ?? "",
        import_source_net_rc: o.import_source_net_rc ?? "",
        import_source_monthly_sale_plan: o.import_source_monthly_sale_plan || "",
        import_source_system: o.import_source_system || "",
        import_source_record_id: o.import_source_record_id || "",
        import_batch_id: o.import_batch_id || "",
      };
    });
}
export function replaceSnapshotPeriod(previousRows, snapshotPeriod, replacement) {
  if (!snapshotPeriodValid(snapshotPeriod)) throw new Error("Invalid snapshot period");
  if (!Array.isArray(replacement)) throw new Error("Snapshot rows must be an array");
  const ids = new Set();
  for (const row of replacement) {
    if (row.snapshot_period !== snapshotPeriod || !row.snapshot_id || !row.opportunity_id || ids.has(String(row.opportunity_id))) {
      throw new Error("Snapshot replacement failed validation; existing period preserved");
    }
    ids.add(String(row.opportunity_id));
  }
  // A published monthly report is immutable. Do not silently replace a
  // historical month with today's live Pipeline state.
  if (previousRows.some((r) => String(r.snapshot_period) === snapshotPeriod)) {
    throw new Error("Snapshot period already captured; historical report is immutable");
  }
  return [...previousRows, ...replacement];
}
