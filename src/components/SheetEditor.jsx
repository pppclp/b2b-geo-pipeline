import React, { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "@/api/client";
import { useData } from "@/lib/dataContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, RefreshCw, Loader2 } from "lucide-react";

// Row editor for the source sheets listed in access_control (b2b_geo_pipeline.yaml).
// Columns come from the sheet's header row; what the user may do comes from the YAML.
export default function SheetEditor() {
  const { refresh } = useData();
  const [sheets, setSheets] = useState([]);
  const [selected, setSelected] = useState("");
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState("");

  // Source sheets only — app-maintained sheets (Opportunities, events, snapshots) are edited elsewhere.
  useEffect(() => {
    db.sheets
      .list()
      .then((list) => {
        const editable = list.filter((s) => !s.app_maintained);
        setSheets(editable);
        if (editable.length) setSelected(`${editable[0].file}|${editable[0].sheet}`);
      })
      .catch((e) => setError(e.message));
  }, []);

  const current = useMemo(() => sheets.find((s) => `${s.file}|${s.sheet}` === selected), [sheets, selected]);

  const load = useCallback(async () => {
    if (!current) return;
    setError("");
    setData(await db.sheets.read(current.file, current.sheet).catch((e) => (setError(e.message), null)));
    setDraft({});
    setConfirmId("");
  }, [current]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      refresh(); // keep dropdowns elsewhere in the app in sync
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const can = (a) => data?.actions?.includes(a);
  const pk = data?.primary_key;

  const saveCell = (row, col, value) => {
    if (String(row[col] ?? "") === value) return;
    run(() => db.sheets.update(current.file, current.sheet, row[pk], { [col]: value }));
  };

  const addRow = () => run(() => db.sheets.create(current.file, current.sheet, draft));

  const removeRow = (id) => {
    if (confirmId !== id) return setConfirmId(id);
    run(() => db.sheets.remove(current.file, current.sheet, id));
  };

  const byFile = useMemo(() => {
    const m = {};
    sheets.forEach((s) => (m[s.file] ||= []).push(s));
    return m;
  }, [sheets]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="w-[360px]"><SelectValue placeholder="Select a sheet" /></SelectTrigger>
          <SelectContent>
            {Object.entries(byFile).map(([file, list]) => (
              <React.Fragment key={file}>
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase text-muted-foreground">{file}</div>
                {list.map((s) => (
                  <SelectItem key={s.sheet} value={`${s.file}|${s.sheet}`}>{s.sheet}</SelectItem>
                ))}
              </React.Fragment>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </Button>
        {data && (
          <span className="text-xs text-muted-foreground">
            {data.rows.length} rows · allowed: {data.actions.join(", ") || "none"}
          </span>
        )}
      </div>

      {error && <div className="mb-3 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}

      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase text-muted-foreground">
                {data.headers.map((h) => (
                  <th key={h} className="text-left font-medium py-2 pr-2 whitespace-nowrap">
                    {h}
                    {h === pk && " 🔑"}
                  </th>
                ))}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row[pk]} className="border-b border-border/60">
                  {data.headers.map((h) => (
                    <td key={h} className="py-1 pr-2 min-w-[120px]">
                      {h === pk || !can("update") ? (
                        <span className="px-2 font-mono text-xs">{String(row[h] ?? "")}</span>
                      ) : (
                        <Input
                          key={String(row[h] ?? "")}
                          className="h-8"
                          defaultValue={String(row[h] ?? "")}
                          onBlur={(e) => saveCell(row, h, e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                        />
                      )}
                    </td>
                  ))}
                  <td className="py-1">
                    {can("delete") && (
                      <Button
                        variant={confirmId === row[pk] ? "destructive" : "ghost"}
                        size="sm"
                        className="h-8"
                        disabled={busy}
                        onClick={() => removeRow(row[pk])}
                        title="Delete row"
                      >
                        {confirmId === row[pk] ? "Confirm" : <Trash2 className="w-4 h-4" />}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {can("create") && (
                <tr>
                  {data.headers.map((h) => (
                    <td key={h} className="pt-3 pr-2">
                      <Input
                        className="h-8"
                        placeholder={h === pk ? "auto" : h}
                        value={draft[h] ?? ""}
                        onChange={(e) => setDraft({ ...draft, [h]: e.target.value })}
                      />
                    </td>
                  ))}
                  <td className="pt-3">
                    <Button size="sm" className="h-8" onClick={addRow} disabled={busy} title="Add row">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
