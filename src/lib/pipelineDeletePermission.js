/**
 * Frontend visibility only. Backend remains authoritative for scope, stale
 * revisions, reasons and append-only Pipeline_Events when an action is sent.
 */
export function canDeletePipeline(profile, opportunity) {
  if (!profile || !opportunity || profile.isDemo) return false;
  const role = String(profile.app_role || "").toLowerCase();
  if (role === "ae") {
    return opportunity.owner_id === profile.id ||
      opportunity.current_handler_id === profile.id;
  }
  if (role === "sm") {
    return (profile.region_ids || []).includes(opportunity.region_id);
  }
  return role === "management" || role === "admin";
}
