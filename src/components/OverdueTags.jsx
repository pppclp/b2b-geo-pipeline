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
  // One warning sign per Pipeline record, only inside the first visible alert tag.
  const warning = <span aria-hidden="true" className="text-[12px] leading-none">⚠</span>;
  return (
    <span className="inline-flex max-w-full flex-wrap justify-end gap-1 text-[10px] leading-4">
      {reasons.stageAging && <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700"
        title="Stage age exceeds global monitoring threshold">{warning} Stage Aging · {days}d</span>}
      {reasons.stageSla && <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700"
        title="Configured SLA for this Stage exceeded">{!reasons.stageAging && warning} Stage SLA · +{slaExcess}d</span>}
      {reasons.overdueTaskCount > 0 && <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700"
        title={reasons.overdueTasks.map(t => t.task_name).join(", ")}>
        {!reasons.stageAging && !reasons.stageSla && warning} Task Overdue · {reasons.overdueTaskCount}</span>}
    </span>
  );
}
