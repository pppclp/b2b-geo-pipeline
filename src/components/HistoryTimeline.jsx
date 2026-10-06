import React from "react";
import { useData } from "@/lib/dataContext";
import { formatDateTime } from "@/lib/pipeline";
import {
  Plus,
  GitBranch,
  ArrowRightLeft,
  CalendarClock,
  Users,
  Wrench,
  Trophy,
  XCircle,
  Archive,
  RefreshCw,
} from "lucide-react";

const EVENT_META = {
  create: { label: "Opportunity created", icon: Plus },
  stage_change: { label: "Stage changed", icon: GitBranch },
  handler_change: { label: "Handoff", icon: ArrowRightLeft },
  reassign: { label: "Reassignment", icon: Users },
  close_month_change: { label: "Expected close month changed", icon: CalendarClock },
  working_with_change: { label: "Working with changed", icon: Wrench },
  support_on: { label: "Support needed enabled", icon: Wrench },
  support_off: { label: "Support needed disabled", icon: Wrench },
  won: { label: "Marked Won", icon: Trophy },
  lost: { label: "Marked Lost", icon: XCircle },
  archived: { label: "Archived", icon: Archive },
  status_change: { label: "Status changed", icon: RefreshCw },
};

export default function HistoryTimeline({ opportunityId }) {
  const { historyFor } = useData();
  const items = historyFor(opportunityId).sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

  if (!items.length) {
    return <p className="text-sm text-muted-foreground">No history yet.</p>;
  }

  return (
    <ol className="relative border-l border-border ml-2 space-y-4">
      {items.map((h) => {
        const meta = EVENT_META[h.event_type] || { label: h.event_type, icon: RefreshCw };
        const Icon = meta.icon;
        return (
          <li key={h.id} className="ml-4">
            <span className="absolute -left-[9px] mt-1 w-4 h-4 rounded-full bg-card border border-border flex items-center justify-center">
              <Icon className="w-2.5 h-2.5 text-muted-foreground" />
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-medium">{meta.label}</span>
              <span className="text-xs text-muted-foreground">{h.actor_name}</span>
            </div>
            {(h.previous_value || h.new_value) && (
              <div className="text-sm text-muted-foreground mt-0.5">
                {h.previous_value && <span>{h.previous_value}</span>}
                {h.previous_value && h.new_value && <span> → </span>}
                {h.new_value && <span className="text-foreground font-medium">{h.new_value}</span>}
              </div>
            )}
            {h.remark && <div className="text-sm text-muted-foreground italic mt-0.5">“{h.remark}”</div>}
            <div className="text-[11px] text-muted-foreground mt-0.5">{formatDateTime(h.created_date)}</div>
          </li>
        );
      })}
    </ol>
  );
}