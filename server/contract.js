// Builds the runtime contract from b2b_geo_pipeline.yaml:
//   access     — access_control section (files, sheets, permissions, scope)
//   references — entity -> [{ entity, col }] rows that point at its primary key
//                (from referenced_by / used_by), used to block unsafe deletes
//   columns    — entity -> column headers for creating empty sheets
// Node-only; the Apps Script build embeds the result as JSON.
import fs from "node:fs";
import YAML from "yaml";

const COMPUTED = new Set(["weighted_pipeline_value", "stage_aging_days", "handler_aging_days", "working_with_aging_days"]);

function refsOf(list) {
  return (list || [])
    .filter((s) => typeof s === "string" && /^\w+\.\w+$/.test(s))
    .map((s) => {
      const [entity, col] = s.split(".");
      return { entity, col };
    });
}

export function buildContract(yamlText) {
  const doc = YAML.parse(yamlText);
  if (!doc.access_control?.files) throw new Error("b2b_geo_pipeline.yaml has no access_control.files section");

  const references = {};
  const columns = {};
  for (const [key, section] of Object.entries(doc)) {
    if (!key.startsWith("source_") || !section || typeof section !== "object") continue;
    for (const [sk, sheet] of Object.entries(section)) {
      if (!sk.startsWith("sheet_") || !sheet?.target_entity) continue;
      const fields = sheet.fields || sheet.field || {};
      columns[sheet.target_entity] = [...new Set([sheet.primary_key, ...Object.keys(fields)])].filter(Boolean);
      const pk = fields[sheet.primary_key] || {};
      const refs = [...refsOf(pk.referenced_by), ...refsOf(pk.used_by), ...refsOf(sheet.referenced_by)];
      const seen = new Set();
      references[sheet.target_entity] = refs.filter((r) => !seen.has(`${r.entity}.${r.col}`) && seen.add(`${r.entity}.${r.col}`));
    }
  }
  if (doc.opportunity_entity?.field_lineage)
    columns.opportunities = Object.keys(doc.opportunity_entity.field_lineage).filter((c) => !COMPUTED.has(c));
  if (doc.opportunity_events?.fields) columns.opportunity_events = Object.keys(doc.opportunity_events.fields);
  if (doc.monthly_snapshots?.fields) columns.monthly_snapshots = Object.keys(doc.monthly_snapshots.fields);

  return { access: doc.access_control, references, columns };
}

export function loadContract(yamlPath) {
  return buildContract(fs.readFileSync(yamlPath, "utf8"));
}
