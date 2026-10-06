import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "@/lib/dataContext";
import { formatTHB, formatMonth, agingDays, ROLE_LABELS } from "@/lib/pipeline";
import KpiCard from "@/components/dashboard/KpiCard";
import RegionQuickFilter from "@/components/dashboard/RegionQuickFilter";
import MonthPicker from "@/components/MonthPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trophy, XCircle, AlertCircle, Clock, PlusCircle, CalendarClock, RotateCcw } from "lucide-react";

function monthOf(iso) {
  if (!iso) return "";
  return iso.slice(0, 7);
}

export default function Dashboard() {
  const { scopedOpportunities, maps, activeStages, config, profile } = useData();
  const navigate = useNavigate();
  const [createdMonth, setCreatedMonth] = useState("");
  const [closeMonth, setCloseMonth] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [categoryDialog, setCategoryDialog] = useState(null);

  const role = profile?.app_role || "ae";
  const isManagementLike = role === "management" || role === "admin";
  const threshold = config?.aging_threshold_days || 14;

  // Available regions for quick filter
  const allRegions = useMemo(
    () => Object.values(maps.region || {}).filter((r) => r.active).sort((a, b) => (a.order || 0) - (b.order || 0)),
    [maps.region]
  );
  const availableRegions = useMemo(() => {
    if (role === "sm") return allRegions.filter((r) => (profile?.region_ids || []).includes(r.id));
    if (isManagementLike) return allRegions;
    return [];
  }, [allRegions, role, profile, isManagementLike]);

  const showRegionFilter = isManagementLike || (role === "sm" && availableRegions.length > 1);

  // Validate region filter against available regions
  const effectiveRegion = availableRegions.find((r) => r.id === regionFilter) ? regionFilter : "";
  const regionScoped = effectiveRegion
    ? scopedOpportunities.filter((o) => o.region_id === effectiveRegion)
    : scopedOpportunities;

  // KPI data
  const open = regionScoped.filter((o) => o.status === "open");
  const created = createdMonth ? open.filter((o) => o.created_month === createdMonth) : open;
  const expected = closeMonth ? open.filter((o) => o.expected_close_month === closeMonth) : open;
  const won = closeMonth
    ? regionScoped.filter((o) => o.status === "won" && monthOf(o.won_at) === closeMonth)
    : regionScoped.filter((o) => o.status === "won");
  const lost = closeMonth
    ? regionScoped.filter((o) => o.status === "lost" && monthOf(o.lost_at) === closeMonth)
    : regionScoped.filter((o) => o.status === "lost");
  const supportNeeded = open.filter((o) => o.support_needed);
  const stuck = open.filter((o) => agingDays(o.stage_entered_at) > threshold);

  const sumVal = (arr) => arr.reduce((a, o) => a + (o.pipeline_value || 0), 0);
  const monthLabel = (m) => (m ? formatMonth(m) : "All Months");

  // Navigation helper — preserves region context
  const go = (params) => {
    const p = { ...params };
    if (effectiveRegion) p.region = effectiveRegion;
    navigate(`/pipeline?${new URLSearchParams(p).toString()}`);
  };

  const resetFilters = () => {
    setCreatedMonth("");
    setCloseMonth("");
    setRegionFilter("");
  };

  const hasActiveFilters = !!createdMonth || !!closeMonth || !!effectiveRegion;

  // Breakdowns
  const byStage = activeStages.map((s) => {
    const ops = open.filter((o) => o.stage_id === s.id);
    return { stage: s, count: ops.length, value: sumVal(ops) };
  });
  const maxStageValue = Math.max(...byStage.map((x) => x.value), 1);

  const categories = Object.values(maps.category || {})
    .filter((c) => c.active)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const byCategory = categories.map((c) => {
    const ops = open.filter((o) => o.product_category_id === c.id);
    return { category: c, count: ops.length, value: sumVal(ops) };
  });

  const byRegion = allRegions
    .map((r) => {
      const ops = open.filter((o) => o.region_id === r.id);
      return { region: r, count: ops.length, value: sumVal(ops) };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.value - a.value);

  const aes = Object.values(maps.member || {}).filter((m) => m.active && m.app_role === "ae");
  const byAE = aes
    .map((m) => {
      const ops = open.filter((o) => o.owner_id === m.id);
      return { member: m, count: ops.length, value: sumVal(ops) };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.value - a.value);

  const lostReasons = Object.values(maps.lostReason || {}).filter((r) => r.active);
  const lostByReason = lostReasons
    .map((r) => {
      const ops = lost.filter((o) => o.lost_reason_id === r.id);
      return { reason: r, count: ops.length, value: sumVal(ops) };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.value - a.value);

  const supportTypes = Object.values(maps.supportType || {})
    .filter((s) => s.active)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const supportByType = supportTypes
    .map((st) => {
      const ops = supportNeeded.filter((o) => o.support_type === st.id);
      return { type: st, count: ops.length, value: sumVal(ops) };
    })
    .filter((x) => x.count > 0);

  // Products in selected category (for drill-down dialog)
  const productsInCategory = useMemo(() => {
    if (!categoryDialog) return [];
    return Object.values(maps.product || {})
      .filter((p) => p.active && p.category_id === categoryDialog.id)
      .map((p) => {
        const ops = open.filter((o) => o.product_id === p.id);
        return { product: p, count: ops.length, value: sumVal(ops) };
      });
  }, [categoryDialog, maps.product, open]);

  // Role-specific lists
  const currentlyWithMe = open.filter((o) => o.current_handler_id === profile?.id);
  const workingWithTeams = open.filter((o) => o.working_with);
  const assignedToMe = open.filter((o) => o.current_handler_id === profile?.id);
  const attentionOps = [...stuck, ...supportNeeded]
    .filter((o, i, arr) => arr.findIndex((x) => x.id === o.id) === i)
    .slice(0, 10);

  return (
    <div className="p-5 md:p-7 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {ROLE_LABELS[role]} view
            {profile?.isProvisional ? " · Provisional admin" : ""}
            {profile?.isDemo ? " (Demo)" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Created Month</span>
            <MonthPicker value={createdMonth} onChange={setCreatedMonth} placeholder="All Months" allowAll className="w-[150px]" />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Expected Close</span>
            <MonthPicker value={closeMonth} onChange={setCloseMonth} placeholder="All Months" allowAll className="w-[150px]" />
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="mb-0.5" onClick={resetFilters}>
              <RotateCcw className="w-4 h-4 mr-1" /> Reset Filters
            </Button>
          )}
        </div>
      </div>

      {/* Region Quick Filter */}
      {showRegionFilter && (
        <div className="mb-5">
          <RegionQuickFilter regions={availableRegions} value={effectiveRegion} onChange={setRegionFilter} />
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <KpiCard
          label="Created"
          count={created.length}
          value={formatTHB(sumVal(created))}
          context={`Created in ${monthLabel(createdMonth)}`}
          icon={PlusCircle}
          onClick={() => go({ status: "open", ...(createdMonth && { created_month: createdMonth }) })}
        />
        <KpiCard
          label="Expected to Close"
          count={expected.length}
          value={formatTHB(sumVal(expected))}
          context={`Expected in ${monthLabel(closeMonth)}`}
          icon={CalendarClock}
          onClick={() => go({ status: "open", ...(closeMonth && { close_month: closeMonth }) })}
        />
        <KpiCard
          label="Won"
          count={won.length}
          value={formatTHB(sumVal(won))}
          context={`Won in ${monthLabel(closeMonth)}`}
          icon={Trophy}
          accent="text-emerald-600"
          onClick={() => go({ status: "won", ...(closeMonth && { won_month: closeMonth }) })}
        />
        <KpiCard
          label="Lost"
          count={lost.length}
          value={formatTHB(sumVal(lost))}
          context={`Lost in ${monthLabel(closeMonth)}`}
          icon={XCircle}
          accent="text-rose-600"
          onClick={() => go({ status: "lost", ...(closeMonth && { lost_month: closeMonth }) })}
        />
        <KpiCard
          label="Support Needed"
          count={supportNeeded.length}
          value={formatTHB(sumVal(supportNeeded))}
          context="Open pipeline needing support"
          icon={AlertCircle}
          accent="text-amber-600"
          onClick={() => go({ status: "open", support: "1" })}
        />
        <KpiCard
          label="Stuck Pipeline"
          count={stuck.length}
          value={formatTHB(sumVal(stuck))}
          context={`> ${threshold} days in current stage`}
          icon={Clock}
          accent="text-amber-600"
          onClick={() => go({ status: "open", stuck: "1", sort: "stage_aging_desc" })}
        />
      </div>

      {/* Role-specific sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pipeline by Region — management only (first) */}
        {isManagementLike && (
          <Panel title="Pipeline by Region" empty={!byRegion.length}>
            <BreakdownList
              rows={byRegion.map((r) => ({ id: r.region.id, name: r.region.name, count: r.count, value: r.value }))}
              onClick={(id) => setRegionFilter(id)}
            />
          </Panel>
        )}

        {/* Pipeline by AE — management + SM */}
        {(isManagementLike || role === "sm") && (
          <Panel title="Pipeline by AE (Owner)" empty={!byAE.length}>
            <BreakdownList
              rows={byAE.map((a) => ({ id: a.member.id, name: a.member.name, count: a.count, value: a.value }))}
              onClick={(id) => go({ status: "open", owner: id })}
            />
          </Panel>
        )}

        {/* Pipeline by Stage — all roles */}
        <Panel title="Pipeline by Stage">
          <div className="space-y-2.5">
            {byStage.map((s) => (
              <button
                key={s.stage.id}
                type="button"
                onClick={() => go({ status: "open", stage: s.stage.id })}
                className="w-full text-left group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[13px] font-medium">{s.stage.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {s.count} · {formatTHB(s.value)}
                  </span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand/70 group-hover:bg-brand transition-all"
                    style={{ width: `${(s.value / maxStageValue) * 100}%` }}
                  />
                </div>
              </button>
            ))}
            {byStage.every((s) => s.count === 0) && <EmptyRow />}
          </div>
        </Panel>

        {/* Pipeline by Product Category — all roles */}
        <Panel title="Pipeline by Product Category">
          <BreakdownList
            rows={byCategory.map((c) => ({ id: c.category.id, name: c.category.name, count: c.count, value: c.value }))}
            onClick={(id) => setCategoryDialog(categories.find((c) => c.id === id))}
          />
        </Panel>

        {/* Lost Reasons — management only */}
        {isManagementLike && (
          <Panel title="Lost Reasons" empty={!lostByReason.length}>
            <BreakdownList
              rows={lostByReason.map((r) => ({ id: r.reason.id, name: r.reason.name, count: r.count, value: r.value }))}
              onClick={(id) => go({ status: "lost", ...(closeMonth && { lost_month: closeMonth }), lost_reason: id })}
            />
          </Panel>
        )}

        {/* Support by Type — all roles if data */}
        {supportByType.length > 0 && (
          <Panel title="Support Needed by Type">
            <BreakdownList
              rows={supportByType.map((s) => ({ id: s.type.id, name: s.type.name, count: s.count, value: s.value }))}
              onClick={() => go({ status: "open", support: "1" })}
            />
          </Panel>
        )}

        {/* Currently With Me — SM */}
        {role === "sm" && (
          <Panel title={`Currently With Me (${currentlyWithMe.length})`} empty={!currentlyWithMe.length}>
            <OpportunityMiniList ops={currentlyWithMe} maps={maps} navigate={navigate} />
          </Panel>
        )}

        {/* Working With Internal Teams — SM */}
        {role === "sm" && (
          <Panel title={`Working With Internal Teams (${workingWithTeams.length})`} empty={!workingWithTeams.length}>
            <OpportunityMiniList ops={workingWithTeams} maps={maps} navigate={navigate} />
          </Panel>
        )}

        {/* Assigned to Me — AE */}
        {role === "ae" && (
          <Panel title={`Assigned to Me (${assignedToMe.length})`} empty={!assignedToMe.length}>
            <OpportunityMiniList ops={assignedToMe} maps={maps} navigate={navigate} />
          </Panel>
        )}

        {/* Attention Needed — management */}
        {isManagementLike && (
          <Panel title="Attention Needed" empty={!attentionOps.length}>
            <OpportunityMiniList ops={attentionOps} maps={maps} navigate={navigate} showReason />
          </Panel>
        )}
      </div>

      {/* Category drill-down dialog */}
      <Dialog open={!!categoryDialog} onOpenChange={(o) => !o && setCategoryDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{categoryDialog?.name} — Products</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 py-2">
            {productsInCategory.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">No products in this category.</p>
            )}
            {productsInCategory.map((p) => (
              <button
                key={p.product.id}
                type="button"
                onClick={() => {
                  go({ status: "open", product_category: categoryDialog.id, product: p.product.id });
                  setCategoryDialog(null);
                }}
                className="w-full flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-secondary/70 transition-colors text-[13px]"
              >
                <span className="font-medium">{p.product.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {p.count} · {formatTHB(p.value)}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Panel({ title, children, empty }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <h3 className="text-[13px] font-semibold mb-4 text-foreground/80">{title}</h3>
      {empty ? <EmptyRow /> : children}
    </div>
  );
}

function BreakdownList({ rows, onClick }) {
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onClick(r.id)}
          className="w-full flex items-center justify-between py-2.5 px-3 -mx-3 rounded-lg text-[13px] hover:bg-secondary/70 transition-colors"
        >
          <span className="font-medium text-foreground/85">{r.name}</span>
          <span className="text-muted-foreground tabular-nums">
            {r.count} · {formatTHB(r.value)}
          </span>
        </button>
      ))}
      {rows.length === 0 && <EmptyRow />}
    </div>
  );
}

function OpportunityMiniList({ ops, maps, navigate, showReason }) {
  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto">
      {ops.slice(0, 10).map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => navigate(`/opportunity/${o.id}`)}
          className="w-full flex items-center justify-between py-2 px-3 -mx-3 rounded-lg hover:bg-secondary/70 transition-colors text-[13px] text-left"
        >
          <div className="min-w-0">
            <div className="font-medium truncate">{o.customer_name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {maps.stage[o.stage_id]?.name} · {maps.member[o.owner_id]?.name}
              {showReason && o.support_needed && " · Support"}
              {showReason && agingDays(o.stage_entered_at) > 14 && " · Stuck"}
            </div>
          </div>
          <span className="text-muted-foreground tabular-nums ml-2 shrink-0">{formatTHB(o.pipeline_value)}</span>
        </button>
      ))}
      {ops.length === 0 && <EmptyRow />}
    </div>
  );
}

function EmptyRow() {
  return <div className="text-sm text-muted-foreground py-6 text-center">No data</div>;
}