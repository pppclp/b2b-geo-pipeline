// Stable data-driven Config / Field_Options values.
// Source: B2B_GEO_Pipeline_Config > Field_Options through read-only FieldOption entity.
export function fieldChoices(master, fieldKey, fallback = []) {
  const configured = (master?.FieldOption || [])
    .filter((o) => o.active && o.field_key === fieldKey)
    .map((o) => ({
      value: String(o.value),
      label: String(o.label || o.value),
      order: Number(o.order ?? 9999),
    }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(({ value, label }) => ({ value, label }));
  // Nonempty configured choices always override bundled defaults. Keep the
  // fallback only for the period before an older Apps Script deployment is upgraded.
  if (configured.length) return configured;
  return fallback.map((item) =>
    typeof item === "string" ? {value:item,label:item} : item);
}
