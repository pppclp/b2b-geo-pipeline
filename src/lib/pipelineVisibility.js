/**
 * Workspace presentation safeguard for a legacy Apps Script deployment.
 * The canonical backend must still enforce Soft Delete and authenticated scope.
 * JP-DEMO is a retired test-only region; its four Pipelines are all in the
 * Recycle Bin in the canonical Sheets DB. Retain rows and Change Log for audit.
 */
const RETIRED_TEST_REGIONS = new Set(["JP-DEMO"]);

export function isVisibleWorkspacePipeline(op) {
  if (!op || typeof op !== "object") return false;
  if (String(op.deleted_at || "").trim()) return false;
  if (RETIRED_TEST_REGIONS.has(String(op.region_id || "").trim())) return false;
  return true;
}

export function isVisibleWorkspaceRegion(region) {
  if (!region || typeof region !== "object") return false;
  if (RETIRED_TEST_REGIONS.has(String(region.id || "").trim())) return false;
  return region.active !== false;
}
