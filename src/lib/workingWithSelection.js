// Stable comma-separated IDs in Pipeline DB. Selection is independent of the UI.
export const splitWorkingIds = (value) => String(value || "")
  .split(",").map((id) => id.trim()).filter(Boolean);

export function toggleWorkingId(value, id, max = 12) {
  const ids = splitWorkingIds(value);
  if (ids.includes(id)) return ids.filter((current) => current !== id).join(",");
  return ids.length < max ? [...ids, id].join(",") : ids.join(",");
}

export function selectableWorkingPeople(people, regionId, selectedIds = "") {
  const selected = new Set(splitWorkingIds(selectedIds));
  return (people || []).filter((person) => {
    if (selected.has(person.id)) return true; // Preserve legacy selections.
    return person.active && (person.region_ids || []).includes(regionId) &&
      person.app_role !== "management"; // Management is a Team, not a person option.
  });
}
