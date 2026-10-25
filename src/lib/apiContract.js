// Bump this only for intentional breaking changes to the API contract.
// The frontend refuses an absent/older contract rather than displaying empty Pipeline data.
export const API_CONTRACT_VERSION = 2;
export const REQUIRED_CAPABILITIES = Object.freeze([
  "pipeline_revision",
  "needs_support_toggle",
  "schema_fail_closed",
  "import_batch_dedupe",
]);
export function validateApiContract(me) {
  if (me?.api_contract_version !== API_CONTRACT_VERSION ||
      !REQUIRED_CAPABILITIES.every(cap => Array.isArray(me?.capabilities) && me.capabilities.includes(cap))) {
    const error = new Error("Backend version mismatch. Your Pipeline data has not been loaded. Contact the UAT operator to deploy matching Apps Script and frontend versions.");
    error.code = "API_CONTRACT_MISMATCH";
    error.status = 503;
    throw error;
  }
  return me;
}
