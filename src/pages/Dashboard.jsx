import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "@/lib/dataContext";
import { formatTHB, formatMonth, currentMonthKey, agingDays, STATUS_LABELS, ROLE_LABELS } from "@/lib/pipeline";
import StatCard from "@/components/StatCard";
import MonthPicker from "@/components/MonthPicker";
import EmptyState from "@/components/EmptyState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trophy, XCircle, AlertCircle, Clock, PlusCircle, CalendarClock, Wrench } from "lucide-react";

function monthOf(iso) {
  if (!iso) return "";
  return iso.slice(0, 7);
}

export default function Dashboard() {
  const { scopedOpportunities, maps, activeStages, config, stageWeightMap, profile } = useData();
  const navigate = useNavigate();
  const [createdMonth, setCreatedMonth] = useState(currentMonthKey());
  const [closeMonth, setCloseMonth] = useState(currentMonthKey());

  const open = scopedOpportunities.filter((o) => o.status === "open");

  const created = open.filter((o) => o.created_month === createdMonth);
  const expected = open.filter((o) => o.expected_close_month === closeMonth);
  const won = scopedOpportunities.filter((o) => o.status === "won" && monthOf(o.won_at) === closeMonth);
  const lost = scopedOpportunities.filter((o) => o.status === "lost" && monthOf(o.lost_at) === closeMonth);
  const supportNeeded = open.filter((o) => o.support_needed);
  const stuck = open.filter((o) => agingDays(o.stage_entered_at) > config.aging_threshold_days);

  const createdValue = created.reduce((a, o) => a + (o.pipeline_value || 0), 0);
  const expectedValue = expected.reduce((a, o) => a + (o.pipeline_value || 0), 0);
  const wonValue = won.reduce((a, o) => a + (o.pipeline_value || 0), 0);
  const lostValue = lost.reduce((a, o) => a + (o.pipeline_value || 0), 0);
  const supportValue = supportNeeded.reduce((a, o) => a + (o.pipeline_value || 0), 0);
  const stuckValue = stuck.reduce((a, o) => a + (o.pipeline_value || 0), 0);

  // Stage distribution (open)
  const byStage = activeStages.map((s) => {
    const ops = open.filter((o) => o.stage_id === s.id);
    return { stage: s, count: ops.length, value: ops.reduce((a, o) => a + (o.pipeline_value || 0), 0) };
  });

  // Region breakdown
  const regions = (Object.values(maps.region || {})).filter((r) => r.active);
  const byRegion = regions
    .map((r) => {
      const ops = open.filter((o) => o.region_id === r.id);
      return { region: r, count: ops.length, value: ops.reduce((a, o) => a + (o.pipeline_value || 0), 0) };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.value - a.value);

  // AE breakdown (owners)
  const aes = (Object.values(maps.member || {})).filter((m) => m.active && m.app_role === "ae");
  const byAE = aes
    .map((m) => {
      const ops = open.filter((o) => o.owner_id === m.id);
      return { member: m, count: ops.length, value: ops.reduce((a, o) => a + (o.pipeline_value || 0), 0) };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.value - a.value);

  // Category breakdown
  const categories = (Object.values(maps.category || {})).filter((c) => c.active).sort((a, b) => a.order - b.order);
  const byCategory = categories.map((c) => {
    const ops = open.filter((o) => o.product_category_id === c.id);
    return { category: c, count: ops.length, value: ops.reduce((a, o) => a + (o.pipeline_value || 0), 0) };
  });

  // Lost reason distribution
  const lostReasons = (Object.values(maps.lostReason || {})).filter((r) => r.active);
  const lostByReason = lostReasons
    .map((r) => ({ reason: r, count: lost.filter((o) => o.lost_reason_id === r.id).length }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);

  const weightedTotal = open.reduce((a, o) => a + (o.pipeline_value || 0) * (stageWeightMap[o.stage_id] || 0), 0);

  const go = (params) => navigate(`/pipeline?${new URLSearchParams(params).toString()}`);

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {ROLE_LABELS[profile?.app_role]} view{profile?.isProvisional ? " · Provisional admin" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase">Created Month</span>
            <MonthPicker value={createdMonth} onChange={setCreatedMonth} className="w-[150px]" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase">Close Month</span>
            <MonthPicker value={closeMonth} onChange={setCloseMonth} className="w-[150px]" />
          </div>
        </div>
      </div>

      {/* Top metric row */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <StatCard label="Created" value={created.length} sub={formatTHB(createdValue)} icon={PlusCircle} onClick={() => go({ created_month: createdMonth, status: "open" })} />
        <StatCard label="Expected to Close" value={expected.length} sub={formatTHB(expectedValue)} icon={CalendarClock} onClick={() => go({ close_month: closeMonth, status: "open" })} />
        <StatCard label="Won" value={won.length} sub={formatTHB(wonValue)} accent="text-emerald-600" icon={Trophy} onClick={() => go({ status: "won", close_month: closeMonth })} />
        <StatCard label="Lost" value={lost.length} sub={formatTHB(lostValue)} accent="text-rose-600" icon={XCircle} onClick={() => go({ status: "lost", close_month: closeMonth })} />
        <StatCard label="Support Needed" value={supportNeeded.length} sub={formatTHB(supportValue)} accent="text-amber-600" icon={AlertCircle} onClick={() => go({ support: "1", status: "open" })} />
        <StatCard label="Stuck" value={stuck.length} sub={formatTHB(stuckValue)} accent="text-amber-600" icon={Clock} onClick={() => go({ status: "open" })} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Stage distribution */}
        <Panel title="Pipeline by Stage">
          <div className="space-y-2">
            {byStage.map((s) => (
              <div key={s.stage.id} className="flex items-center gap-3">
                <span className="w-28 text-sm truncate">{s.stage.name}</span>
                <div className="flex-1 h-6 bg-secondary rounded overflow-hidden">
                  <div className="h-full bg-primary/80" style={{ width: `${byStage.length ? (s.value / Math.max(...byStage.map((x) => x.value), 1)) * 100 : 0}%` }} />
                </div>
                <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">{s.count}</span>
                <span className="w-20 text-right text-sm tabular-nums">{formatTHB(s.value)}</span>
              </div>
            ))}
            {byStage.every((s) => s.count === 0) && <EmptyRow />}
          </div>
        </Panel>

        {/* Region view */}
        <Panel title="Pipeline by Region" empty={!byRegion.length}>
          <BreakdownTable rows={byRegion.map((r) => ({ id: r.region.id, name: r.region.name, count: r.count, value: r.value }))} onClick={(id) => go({ region: id, status: "open" })} />
        </Panel>

        {/* AE view */}
        <Panel title="Pipeline by AE (Owner)" empty={!byAE.length}>
          <BreakdownTable rows={byAE.map((a) => ({ id: a.member.id, name: a.member.name, count: a.count, value: a.value }))} onClick={(id) => go({ owner: id, status: "open" })} />
        </Panel>

        {/* Product Category */}
        <Panel title="Pipeline by Product Category" empty={!byCategory.length}>
          <BreakdownTable
            rows={byCategory.map((c) => ({ id: c.category.id, name: c.category.name, count: c.count, value: c.value }))}
            onClick={(id) => go({ category: id, status: "open" })}
          />
        </Panel>

        {/* Lost reasons */}
        {lostByReason.length > 0 && (
          <Panel title="Lost Reasons">
            <div className="space-y-2">
              {lostByReason.map((r) => (
                <div key={r.reason.id} className="flex items-center justify-between text-sm">
                  <span>{r.reason.name}</span>
                  <span className="tabular-nums text-muted-foreground">{r.count}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Weighted pipeline */}
        {config.weighted_enabled && (
          <Panel title="Weighted Pipeline">
            <div className="text-2xl font-semibold tabular-nums">{formatTHB(weightedTotal)}</div>
            <p className="text-xs text-muted-foreground mt-1">Open pipeline × stage weight</p>
          </Panel>
        )}
      </div>
    </div>
  );
}

function Panel({ title, children, empty }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium mb-3">{title}</h3>
      {empty ? <EmptyRow /> : children}
    </div>
  );
}

function BreakdownTable({ rows, onClick }) {
  return (
    <div className="divide-y divide-border">
      {rows.map((r) => (
        <button key={r.id} onClick={() => onClick(r.id)} className="w-full flex items-center justify-between py-2 text-sm hover:bg-secondary/40 -mx-2 px-2 rounded">
          <span className="font-medium">{r.name}</span>
          <span className="text-muted-foreground tabular-nums">{r.count} · {formatTHB(r.value)}</span>
        </button>
      ))}
    </div>
  );
}

function EmptyRow() {
  return <div className="text-sm text-muted-foreground py-4 text-center">No data</div>;
}