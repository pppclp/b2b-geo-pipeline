// Prevent spreadsheet formula execution when users open a CSV in Excel.
// Quote CSV fields *after* prefixing dangerous text as data.
export function safeCsvCell(value) {
  const text = String(value ?? "");
  const literal = /^[\s\uFEFF\u0000-\u001F]*[=+\-@]/u.test(text) ? "'" + text : text;
  return `"${literal.replace(/"/g, '""')}"`;
}

export function safeCsvTable(headers, rows) {
  return [headers, ...rows].map((row) => row.map(safeCsvCell).join(",")).join("\r\n");
}
