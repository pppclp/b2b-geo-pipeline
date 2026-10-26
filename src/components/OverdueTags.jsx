import React from "react";
import { overdueReasons } from "@/lib/overdueSummary.js";
import { ageInDays } from "@/lib/dashboardMetrics.js";

// One row per Pipeline, up to three distinct flags. Flags can overlap.
export default function OverdueTags({ op, stages = {}, stageWatchDays = 7, tasks = [] }) {
  const reasons = overdueReasons(op, stages, stageWatchDays, tasks);
  if (!reasons.any) return null;
  const days = ageInDays(op.stage_entered_at);
  const limit = stages?.[op.stage_id]?.sla_days;
  const slaExcess = Number.isFinite(days) && Number.isFinite(Number(limit)) ? days - Number(limit) : null;
  return (
    <span className="inline-flex max-w-full flex-wrap justify-end gap-1 text-[10px] leading-4">
      {reasons.stageAging && <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800"
        title="Stage age exceeds global monitoring threshold">Stage Aging · {days}d</span>}
      {reasons.stageSla && <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700"
        title="Configured SLA for this Stage exceeded">Stage SLA · +{slaExcess}d</span>}
      {reasons.overdueTaskCount > 0 && <span className="rounded bg-rose-50 px-1.5 py-0.5 font-medium text-rose-700"
        title={reasons.overdueTasks.map(t => t.task_name).join(", ")}>
        Task Overdue · {reasons.overdueTaskCount}</span>}
    </span>
  );
}
