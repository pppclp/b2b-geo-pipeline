import React, { useState } from "react";
import { useData } from "@/lib/dataContext";
import { currentPipelineTasks } from "@/lib/overdueSummary.js";
import { Button } from "@/components/ui/button";

// Tasks do not replace the existing Quick Actions. This is a small optional
// section visible only when a Scenario × Stage template has been configured.
export default function PipelineTaskPanel({ op }) {
  const { taskEntries, saveTask, profile } = useData();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const tasks = currentPipelineTasks(op, taskEntries).slice().sort((a,b) => a.sort_order - b.sort_order);
  if (!tasks.length) return null;
  const canEdit = op.status === "open" && !!profile && (
    ["sm","management","admin"].includes(profile.app_role) ||
    op.owner_id === profile.id || op.current_handler_id === profile.id);
  async function act(task, status) {
    setBusy(task.task_id);
    setError("");
    try { await saveTask(op.id, task.task_id, status, task.updated_at || ""); }
    catch (e) { setError(e?.message || "Could not save Task progress. Refresh and try again."); }
    finally { setBusy(""); }
  }
  return (
    <section className="border-t pt-4 space-y-2" aria-label="Current Stage tasks">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Stage Tasks</h3>
        <span className="text-[11px] text-muted-foreground">{tasks.filter(t => t.status === "done").length}/{tasks.length} completed</span>
      </div>
      {tasks.map(task => (
        <div key={task.task_id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium" title={task.task_name}>{task.task_name}</p>
            <p className={`text-[11px] ${task.overdue ? "text-red-700 font-medium" : "text-muted-foreground"}`}>
              {task.status === "done" ? "Completed" : task.status === "in_progress" ? "In Progress" : "Not Started"}
              {task.sla_days ? ` · SLA ${task.sla_days} ${task.day_type} days` : " · SLA not set"}
              {task.overdue ? ` · Task overdue +${task.overdue_days}d` : ""}
            </p>
          </div>
          {canEdit && task.status !== "done" && (
            <Button type="button" variant="outline" size="sm" disabled={!!busy || (task.start_policy === "after_previous" && task.status === "not_started" && !task.started_at)}
              onClick={() => act(task, task.status === "not_started" ? "in_progress" : "done")}>
              {busy === task.task_id ? "Saving…" : task.status === "not_started" ? "Start" : "Done"}
            </Button>
          )}
        </div>
      ))}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </section>
  );
}
