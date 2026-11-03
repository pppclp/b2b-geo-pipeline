import React from "react";
import { overdueReasons } from "@/lib/overdueSummary.js";
import { ageInDays } from "@/lib/dashboardMetrics.js";

// All visible alert tags independently carry ⚠. Stage Aging stays informational.
export default function OverdueTags({ op, stages = {}, stageWatchDays = 7, tasks = [], alertContext = {} }) {
  const reasons = overdueReasons(op, stages, stageWatchDays, tasks, alertContext);
  if (!reasons.any) return null;
  const age = ageInDays(op.stage_entered_at);
  const limit = stages?.[op.stage_id]?.sla_days;
  const slaExcess = Number.isFinite(age) && Number.isFinite(Number(limit)) ? age - Number(limit) : null;
  const tone = "inline-flex items-center gap-1 rounded bg-[#C83F40] px-1.5 py-0.5 font-medium text-white";
  return (
    <span className="inline-flex max-w-full flex-wrap justify-end gap-1 text-[10px] leading-4">
      {reasons.stageSla && <span className={tone}
        title={`Stage age: ${age} days · SLA: ${limit} days · Overdue: ${slaExcess} days`}>
        ⚠ Stage SLA · {age}d</span>}
      {reasons.handler && <span className={tone}
        title={`With ${reasons.handler.role.toUpperCase()}: ${reasons.handler.age} days · SLA: ${reasons.handler.limit} days · Overdue: ${reasons.handler.overdueDays} days`}>
        ⚠ With {reasons.handler.role.toUpperCase()} · {reasons.handler.age} Days</span>}
      {reasons.workingWithTeams.map(team => <span key={team.id} className={tone}
        title={`${team.name} Working With age: ${team.age} days · SLA: ${team.limit} days · Overdue: ${team.overdueDays} days`}>
        ⚠ With {team.name} · {team.age}d</span>)}
      {reasons.overdueTaskCount > 0 && <span className={tone}
        title={reasons.overdueTasks.map(t => t.task_name).join(", ")}>
        ⚠ Task Overdue · {reasons.overdueTaskCount} tasks</span>}
    </span>
  );
}
