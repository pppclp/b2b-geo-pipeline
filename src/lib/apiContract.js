// Keep v2 for backwards-compatible backend-first rollout; newer UI requires the scenario_task_overdue capability.
// The frontend refuses an absent/older contract rather than displaying empty Pipeline data.
export const API_CONTRACT_VERSION = 2;
export const UAT_EMAIL_ACTIVATION_CAPABILITY = "corporate_email_activation_v1";
export const REQUIRED_CAPABILITIES = Object.freeze([
  "pipeline_revision",
  "needs_support_toggle",
  "schema_fail_closed",
  "import_batch_dedupe",
  "scenario_task_overdue",
  "legacy_import_owner_resolution",
]);
export function validateApiContract(me) {
  const activationRequested = import.meta.env?.VITE_GEO_EMAIL_AUTH_ENABLED === "true" ||
    import.meta.env?.VITE_GEO_EMAIL_ACTIVATION_ENABLED === "true";
  if (me?.api_contract_version !== API_CONTRACT_VERSION ||
      !REQUIRED_CAPABILITIES.every(cap => Array.isArray(me?.capabilities) && me.capabilities.includes(cap)) ||
      (activationRequested && !me?.capabilities?.includes(UAT_EMAIL_ACTIVATION_CAPABILITY))) {
    const error = new Error("Backend version mismatch. Your Pipeline data has not been loaded. Contact your system administrator to deploy matching Apps Script and frontend versions.");
    error.code = "API_CONTRACT_MISMATCH";
    error.status = 503;
    throw error;
  }
  return me;
}
