import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "@/lib/dataContext";
import { formatTHB, formatMonth, agingDays, ROLE_LABELS } from "@/lib/pipeline";
import KpiCard from "@/components/dashboard/KpiCard";
import RegionQuickFilter from "@/components/dashboard/RegionQuickFilter";
import HBarChart from "@/components/dashboard/HBarChart";
import MonthTrendChart from "@/components/dashboard/MonthTrendChart";
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
  const [aeRankMode, setAeRankMode] = useState("top");
  const [aeRankMetric, setAeRankMetric] = useState("value");

  const role = profile?.app_role || "ae";
  const isManagementLike = role === "management" || role === "admin";
  const threshold = config?.aging_threshold_days || 14;

  // Regions
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

  // Navigation helper — preserves dashboard filters
  const go = (params) => {
    const p = { ...params };
    if (effectiveRegion) p.region = effectiveRegion;
    if (createdMonth && p.status !== "won" && p.status !== "lost" && !p.created_month) p.created_month = createdMonth;
    if (closeMonth && p.status !== "won" && p.status !== "lost" && !p.close_month) p.close_month = closeMonth;
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
    return { id: s.id, name: s.name, count: ops.length, value: sumVal(ops) };
  });

  const categories = Object.values(maps.category || {})
    .filter((c) => c.active)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const byCategory = categories.map((c) => {
    const ops = open.filter((o) => o.product_category_id === c.id);
    return { id: c.id, name: c.name, count: ops.length, value: sumVal(ops) };
  });

  const byRegion = allRegions
    .map((r) => {
      const ops = open.filter((o) => o.region_id === r.id);
      return { id: r.id, name: r.name, count: ops.length, value: sumVal(ops) };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.value - a.value);

  const aes = Object.values(maps.member || {}).filter((m) => m.active && m.app_role === "ae");
  const byAE = aes
    .map((m) => {
      const ops = open.filter((o) => o.owner_id === m.id);
      return { id: m.id, name: m.name, count: ops.length, value: sumVal(ops) };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.value - a.value);

  // Top/Bottom 10 AE — calculated AFTER role/region scope and dashboard filters
  const rankedAE = useMemo(() => {
    if (aeRankMode === "top") {
      return [...byAE].sort((a, b) => (aeRankMetric === "value" ? b.value - a.value : b.count - a.count)).slice(0, 10);
    }
    return [...byAE].sort((a, b) => (aeRankMetric === "value" ? a.value - b.value : a.count - b.count)).slice(0, 10);
  }, [byAE, aeRankMode, aeRankMetric]);

  const lostReasons = Object.values(maps.lostReason || {}).filter((r) => r.active);
  const lostByReason = lostReasons
    .map((r) => {
      const ops = lost.filter((o) => o.lost_reason_id === r.id);
      return { id: r.id, name: r.name, count: ops.length, value: sumVal(ops) };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.value - a.value);

  const supportTypes = Object.values(maps.supportType || {})
    .filter((s) => s.active)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const supportByType = supportTypes
    .map((st) => {
      const ops = supportNeeded.filter((o) => o.support_type === st.id);
      return { id: st.id, name: st.name, count: ops.length, value: sumVal(ops) };
    })
    .filter((x) => x.count > 0);

  // Expected Close by Month
  const closeByMonth = useMemo(() => {
    const monthMap = {};
    open.forEach((o) => {
      const m = o.expected_close_month;
      if (!m) return;
      if (!monthMap[m]) monthMap[m] = { month: m, count: 0, value: 0 };
      monthMap[m].count++;
      monthMap[m].value += o.pipeline_value || 0;
    });
    return Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month)).slice(0, 6);
  }, [open]);

  // Stuck by Stage
  const stuckByStage = activeStages
    .map((s) => {
      const ops = stuck.filter((o) => o.stage_id === s.id);
      return { id: s.id, name: s.name, count: ops.length, value: sumVal(ops) };
    })
    .filter((x) => x.count > 0);

  // Products in selected category (for drill-down dialog)
  const productsInCategory = useMemo(() => {
    if (!categoryDialog) return [];
    return Object.values(maps.product || {})
      .filter((p) => p.active && p.category_id === categoryDialog.id)
      .map((p) => {
        const ops = open.filter((o) => o.product_id === p.id);
        return { id: p.id, name: p.name, count: ops.length, value: sumVal(ops) };
      })
      .filter((x) => x.count > 0)
      .sort((a, b) => b.value - a.value);
  }, [categoryDialog, maps.product, open]);

  // Region chart visibility — only show when multi-region comparison is meaningful
  const aeRegionCount = new Set(open.map((o) => o.region_id).filter(Boolean)).size;
  const showRegionChart = isManagementLike
    ? byRegion.length > 1
    : role === "sm"
    ? availableRegions.length > 1 && byRegion.length > 1
    : aeRegionCount > 1 && byRegion.length > 1;

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
          <h1 className="text-[22px] font-semibold tracking-tight">Dashboard</h1>
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
          onClick={() => go({ status: "open" })}
        />
        <KpiCard
          label="Expected to Close"
          count={expected.length}
          value={formatTHB(sumVal(expected))}
          context={`Expected in ${monthLabel(closeMonth)}`}
          icon={CalendarClock}
          onClick={() => go({ status: "open" })}
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

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Pipeline by Region — management always; SM if multi-region; AE if multi-region data */}
        {showRegionChart && (
          <Panel title="Pipeline by Region" empty={!byRegion.length}>
            <HBarChart data={byRegion} onClick={(id) => setRegionFilter(id)} />
          </Panel>
        )}

        {/* Pipeline by AE — management + SM, with Top/Bottom 10 toggle */}
        {(isManagementLike || role === "sm") && (
          <Panel
            title="Pipeline by AE (Owner)"
            empty={!byAE.length}
            action={
              <div className="flex items-center gap-2">
                <ToggleGroup
                  options={[{ value: "top", label: "Top 10" }, { value: "bottom", label: "Bottom 10" }]}
                  value={aeRankMode}
                  onChange={setAeRankMode}
                />
                <ToggleGroup
                  options={[{ value: "value", label: "Value" }, { value: "count", label: "Count" }]}
                  value={aeRankMetric}
                  onChange={setAeRankMetric}
                />
              </div>
            }
          >
            <HBarChart data={rankedAE} onClick={(id) => go({ status: "open", owner: id })} />
          </Panel>
        )}

        {/* Pipeline by Stage — all roles */}
        <Panel title="Pipeline by Stage">
          <HBarChart data={byStage} preserveOrder onClick={(id) => go({ status: "open", stage: id })} />
        </Panel>

        {/* Pipeline by Product Category — all roles */}
        <Panel title="Pipeline by Product Category">
          <HBarChart
            data={byCategory}
            onClick={(id) => setCategoryDialog(categories.find((c) => c.id === id))}
          />
        </Panel>

        {/* Expected Close by Month — all roles if data */}
        {closeByMonth.length > 0 && (
          <Panel title="Expected Close by Month">
            <MonthTrendChart data={closeByMonth} onClick={(m) => go({ status: "open", close_month: m })} />
          </Panel>
        )}

        {/* Lost Reasons — all roles if data */}
        {lostByReason.length > 0 && (
          <Panel title="Lost Reasons" empty={!lostByReason.length}>
            <HBarChart
              data={lostByReason}
              onClick={(id) => go({ status: "lost", ...(closeMonth && { lost_month: closeMonth }), lost_reason: id })}
            />
          </Panel>
        )}

        {/* Support Needed by Type — all roles if data */}
        {supportByType.length > 0 && (
          <Panel title="Support Needed by Type">
            <HBarChart
              data={supportByType}
              onClick={(id) => go({ status: "open", support: "1", support_type: id })}
            />
          </Panel>
        )}

        {/* Stuck Pipeline by Stage — all roles if data */}
        {stuckByStage.length > 0 && (
          <Panel title="Stuck Pipeline by Stage">
            <HBarChart
              data={stuckByStage}
              preserveOrder
              onClick={(id) => go({ status: "open", stuck: "1", stage: id })}
            />
          </Panel>
        )}
      </div>

      {/* Operational lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Assigned to Me — AE */}
        {role === "ae" && (
          <Panel title={`Assigned to Me (${assignedToMe.length})`} empty={!assignedToMe.length}>
            <OpportunityMiniList ops={assignedToMe} maps={maps} navigate={navigate} />
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

        {/* Attention Needed — management */}
        {isManagementLike && (
          <Panel title="Attention Needed" empty={!attentionOps.length}>
            <OpportunityMiniList ops={attentionOps} maps={maps} navigate={navigate} showReason />
          </Panel>
        )}

        {/* Support Needed list — all roles if data */}
        {supportNeeded.length > 0 && (
          <Panel title={`Support Needed (${supportNeeded.length})`}>
            <OpportunityMiniList ops={supportNeeded.slice(0, 10)} maps={maps} navigate={navigate} showReason />
          </Panel>
        )}

        {/* Stuck Opportunities list — all roles if data */}
        {stuck.length > 0 && (
          <Panel title={`Stuck Opportunities (${stuck.length})`}>
            <OpportunityMiniList ops={stuck.slice(0, 10)} maps={maps} navigate={navigate} showReason />
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
                key={p.id}
                type="button"
                onClick={() => {
                  go({ status: "open", category: categoryDialog.id, product: p.id });
                  setCategoryDialog(null);
                }}
                className="w-full flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-secondary/70 transition-colors text-[12px]"
              >
                <span className="font-medium">{p.name}</span>
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

function ToggleGroup({ options, value, onChange }) {
  return (
    <div className="inline-flex rounded-lg bg-secondary p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 text-[11px] rounded-md font-medium transition-all ${
            value === opt.value
              ? "bg-card text-foreground shadow-soft"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Panel({ title, children, empty, action }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h3 className="text-[12px] font-semibold text-foreground/80">{title}</h3>
        {action}
      </div>
      {empty ? <EmptyRow /> : children}
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
          className="w-full flex items-center justify-between py-2 px-3 -mx-3 rounded-lg hover:bg-secondary/70 transition-colors text-[12px] text-left"
        >
          <div className="min-w-0">
            <div className="font-medium truncate">{o.customer_name}</div>
            <div className="text-[11px] text-muted-foreground truncate">
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