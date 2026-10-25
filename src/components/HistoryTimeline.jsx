import React, { useEffect, useState, useCallback } from "react";
import { db } from "@/api/client";
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
  create: { label: "Pipeline created", icon: Plus },
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

// Multi-select collaborators are stored by stable IDs; show names in History.
function auditValue(field, value, maps) {
  if (!["working_with_teams", "working_with_people", "working_with"].includes(field)) return value;
  if (!value) return "None";
  const dictionary = field === "working_with_people" ? maps.member : maps.workingWith;
  return String(value).split(",").filter(Boolean)
    .map((id) => dictionary?.[id]?.name || id).join(", ");
}

export default function HistoryTimeline({ opportunityId, revision }) {
  const { profile, maps } = useData();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Fetch only this deal's history when its detail view opens.
  const loadHistory = useCallback(async () => {
    if (!opportunityId) return;
    setLoading(true);
    setError("");
    try {
      const rows = await db.entities.OpportunityHistory.filter({ opportunity_id: opportunityId }, "-created_date");
      setItems(rows.slice().sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
    } catch (e) {
      setError(e.message || "Unable to load history");
    } finally {
      setLoading(false);
    }
  }, [opportunityId, profile?.id, revision]);
  useEffect(() => {
    let active = true;
    setItems([]);
    setLoading(true);
    setError("");
    db.entities.OpportunityHistory.filter({ opportunity_id: opportunityId }, "-created_date")
      .then((rows) => {
        if (active) setItems(rows.slice().sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
      })
      .catch((e) => { if (active) setError(e.message || "Unable to load history"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [opportunityId, profile?.id, revision]);

  if (loading) return <p role="status" className="text-sm text-muted-foreground">Loading this Pipeline's history…</p>;
  if (error) return (
    <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
      <span>{error}</span>
      <button type="button" className="underline" onClick={loadHistory}>Retry</button>
    </div>
  );
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">No history yet.</p>;
  }

  return (
    <ol className="relative border-l border-border ml-2 space-y-4">
      {items.map((h) => {
        const meta = EVENT_META[h.event_type] || { label: h.event_type, icon: RefreshCw };
        const Icon = meta.icon;
        const previous = auditValue(h.field, h.previous_value, maps);
        const next = auditValue(h.field, h.new_value, maps);
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
                {previous && <span>{previous}</span>}
                {previous && next && <span> → </span>}
                {next && <span className="text-foreground font-medium">{next}</span>}
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