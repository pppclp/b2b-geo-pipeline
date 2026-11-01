// Province coverage is independent from Region access. NE1 and NE2 can
// overlap: user authorization is governed only by active User_Region entries.
// The province names come from Users.assigned_provinces, not a hardcoded
// AE-to-Region mapping or automatic owner/region reassignment.
export const OVERLAPPING_NE_REGIONS = Object.freeze(["NE1", "NE2"]);

export function selectAuthorizedRegions(regions = [], profile = {}) {
  const nationwide = ["admin", "management"].includes(profile?.app_role);
  const permitted = new Set(profile?.region_ids || []);
  return regions.filter((r) => r.active && (nationwide || permitted.has(r.id)))
    .slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

export function provinceCoverageOptions(members = []) {
  const byProvince = new Map();
  for (const member of members) {
    if (!member.active || member.app_role !== "ae") continue;
    const provinces = String(member.assigned_provinces || "")
      .split(",").map(v => v.trim()).filter(Boolean);
    for (const province of provinces) {
      // Do not silently choose a winner if master data has overlapping claims.
      const key = province.toLowerCase();
      if (!byProvince.has(key)) byProvince.set(key, { province, members: [] });
      byProvince.get(key).members.push({ id: member.id, name: member.name });
    }
  }
  return [...byProvince.values()].sort((a, b) => a.province.localeCompare(b.province));
}

export function provinceCoverageMatch(entries = [], province = "") {
  return entries.find(x => x.province.toLowerCase() === String(province).trim().toLowerCase()) || null;
}
