import React, { useMemo, useState } from "react";
import { actionableErrorMessage } from "@/lib/actionFeedback";
import { useNavigate } from "react-router-dom";
import { useData } from "@/lib/dataContext";
import { formatNetRc as formatTHB } from "@/lib/netRc";
import { currentMonthKey } from "@/lib/pipeline";
import { dashboardCohort, dashboardMetrics } from "@/lib/dashboardMetrics";
import { overdueReasons } from "@/lib/overdueSummary.js";
import MonthPicker from "@/components/MonthPicker";
import RegionQuickFilter from "@/components/dashboard/RegionQuickFilter";
import PageHeader from "@/components/PageHeader";
import { regionDisplayContext } from "@/lib/pipelineListPresentation";
import { withMePipelines } from "@/lib/dashboardQueue";
import { WORK_VIEW_SUBTITLES, selectedCloseMonthSubtitle } from "@/lib/uiCopy";
import { Button } from "@/components/ui/button";
import { AlertCircle, RotateCcw, Settings2, Upload } from "lucide-react";

const sumValue = (items) => items.reduce((total, item) => total + (Number(item.pipeline_value) || 0), 0);
const isOpen = (item) => item.status === "open";
const compactDate = (month) => month || "All Months";

export default function Dashboard() {
  const { scopedOpportunities, maps, master, activeStages, profile, config, taskEntries, loading, error, refresh } = useData();
  const navigate = useNavigate();
  const [createdMonth, setCreatedMonth] = useState("");
  const [closeMonth, setCloseMonth] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [queueTab, setQueueTab] = useState("with");

  const role = profile?.app_role || "ae";
  const isAdmin = role === "admin";
  const isManagement = role === "management";
  const isSM = role === "sm";
  const isAE = role === "ae";

  // UI filters are not access controls: all charts begin with server-scoped opportunities.
  const regions = useMemo(
    () => Object.values(maps.region || {}).filter((r) => r.active)
      .filter((r) => isAdmin || isManagement || (profile?.region_ids || []).includes(r.id))
      .sort((a, b) => (a.order || 0) - (b.order || 0)),
    [maps.region, profile?.region_ids, isAdmin, isManagement]
  );
  const region = regions.some((r) => r.id === regionFilter) ? regionFilter : "";
  // The same context rule applies to AE, SM, Management, and Admin.
  const showRegions = regions.length > 1;
  const cohort = dashboardCohort(scopedOpportunities, { createdMonth, closeMonth, region });
  const regionContext = regionDisplayContext(cohort, maps.region, region, regions.map(r => r.id));
  // Assigned work may belong to a different AE; never credit it to this AE's sales.
  const sales = isAE ? cohort.filter((o) => o.owner_id === profile?.id) : cohort;
  const { open, won } = dashboardMetrics(sales, {
    stages: maps.stage, internalTaskSlaDays: config?.internal_task_sla_days,
  });
  const overdue = open.filter(o => overdueReasons(o, maps.stage, config?.stage_watch_days, taskEntries).any);
  const assigned = withMePipelines(cohort, profile?.id, {
    role, teams: master?.WorkingWithOption,
  });
  const assignedOverdue = assigned.filter(o => overdueReasons(o, maps.stage, config?.stage_watch_days, taskEntries).any);
  const withMeQuery = isManagement ? { with_me: "1" } : { handler: profile?.id };

  const reset = () => { setCreatedMonth(""); setCloseMonth(""); setRegionFilter(""); };
  const hasFilters = Boolean(createdMonth || closeMonth || region);
  const params = (extra = {}) => ({
    ...(createdMonth ? { created_month: createdMonth } : {}),
    ...(closeMonth ? { close_month: closeMonth } : {}),
    ...(region ? { region } : {}),
    ...extra,
  });
  const toPipeline = (extra = {}) => navigate("/pipeline?" + new URLSearchParams(params(extra)).toString());

  const categories = Object.values(maps.category || {})
    .filter((c) => c.active).sort((a, b) => (a.order || 0) - (b.order || 0));
  const stageRows = activeStages.map((s) => {
    const items = open.filter((o) => o.stage_id === s.id);
    return { id: s.id, name: s.name, count: items.length, value: sumValue(items) };
  });
  const categoryRows = categories.map((c) => {
    const items = open.filter((o) => o.product_category_id === c.id);
    return { id: c.id, name: c.name, count: items.length, value: sumValue(items) };
  });
  const regionRows = regions.map((r) => {
    const items = open.filter((o) => o.region_id === r.id);
    return { id: r.id, name: r.name, count: items.length, value: sumValue(items) };
  }).filter((r) => r.count > 0).sort((a, b) => b.value - a.value);
  const ownerRows = Object.values(maps.member || {})
    .filter((m) => m.active && m.app_role === "ae")
    .map((m) => {
      const items = open.filter((o) => o.owner_id === m.id);
      return { id: m.id, name: m.name, count: items.length, value: sumValue(items) };
    }).filter((r) => r.count > 0).sort((a, b) => b.value - a.value);

  const tabs = isManagement
    ? [["with", "With Me"], ["overdue", "Overdue"], ["due", closeMonth ? "Due in Selected Month" : "Due This Month"]]
    : isSM
      ? [["with", "With Me"], ["overdue", "Overdue With Me"], ["due", closeMonth ? "Due in Selected Month" : "Due This Month"]]
      : [["with", "With Me"], ["overdue", "Overdue With Me"], ["due", closeMonth ? "Due in Selected Month" : "Due This Month"]];
  const selectedTab = tabs.some(([id]) => id === queueTab) ? queueTab : "with";
  const queue = selectedTab === "with" ? assigned
    : selectedTab === "overdue" ? (isManagement ? overdue : assignedOverdue)
    : open.filter((o) => o.expected_close_month === (closeMonth || currentMonthKey()));
  const queueItems = queue.slice().sort((a, b) => {
    const agingKey = selectedTab === "with" ? "handler_since" : "stage_entered_at";
    // Never rank an unknown timestamp as 1970 (oldest); handler aging
    // must not quietly fall back to the unrelated stage clock.
    const timeOf = (row) => {
      const ts = row[agingKey] ? Date.parse(row[agingKey]) : NaN;
      return Number.isFinite(ts) ? ts : Infinity;
    };
    const aTime = timeOf(a), bTime = timeOf(b);
    return aTime === bTime ? String(a.id || "").localeCompare(String(b.id || "")) : aTime - bTime;
  }).slice(0, 8);
  const closeValue = sumValue(won) + sumValue(open);

  if (loading || error) {
    return (
      <div className="geo-page">
        <PageHeader title="Dashboard" className="mb-5" />
        <div role={error ? "alert" : "status"} className="rounded-xl border border-border bg-card p-4 flex gap-3 items-center">
          <AlertCircle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <div className="flex-1 text-sm">
            {error ? actionableErrorMessage(error, "load") : "Loading Pipeline data…"}
          </div>
          {error && <Button type="button" variant="outline" onClick={refresh}>Retry</Button>}
        </div>
      </div>
    );
  }

  if (isAdmin) {
    return (
      <div className="geo-page space-y-4">
        <PageHeader title="Dashboard" description="Data & Access" />
        {showRegions && <RegionQuickFilter regions={regions} value={region} onChange={setRegionFilter} />}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Panel title="User & Organization"><p className="text-xs text-muted-foreground mb-3">Manage users and authorized Region mappings.</p>
            <Button type="button" variant="outline" onClick={() => navigate("/admin")}><Settings2 className="h-4 w-4 mr-2" />Open Admin</Button></Panel>
          <Panel title="Pipeline Import"><p className="text-xs text-muted-foreground mb-3">Review and import Pipeline records.</p>
            <Button type="button" variant="outline" onClick={() => navigate("/import")}><Upload className="h-4 w-4 mr-2" />Open Import</Button></Panel>
        </div>
        <Panel title="Business Overview">
          <p className="text-sm text-muted-foreground">You can review {cohort.length} Pipelines for {regionContext.label}. Region breakdown below shows Open Pipeline Net RC.</p>
          <Button type="button" variant="outline" className="mt-3" onClick={() => navigate("/pipeline")}>Open Pipeline</Button>
        </Panel>
        <Panel title="มูลค่างานที่ยังเปิดอยู่แยกตามภาค" >
          <BreakdownTable rows={regionRows} label="Region"
            onSelect={(id) => toPipeline({ status: "open", region: id })} />
        </Panel>
      </div>
    );
  }

  return (
    <div className="geo-page space-y-4">
      <PageHeader
        title="Dashboard"
        actions={
          <div className="flex min-w-0 flex-wrap items-end gap-3">
          <div className="w-[150px]">
            <label className="geo-filter-label block mb-1.5">เดือนที่สร้างงาน</label>
            <MonthPicker value={createdMonth} onChange={setCreatedMonth} placeholder="All Months" allowAll />
          </div>
          <div className="w-[150px]">
            <label className="geo-filter-label block mb-1.5">เดือนที่คาดว่าจะปิดงาน</label>
            <MonthPicker value={closeMonth} onChange={setCloseMonth} placeholder="All Months" allowAll />
          </div>
            {hasFilters && <Button size="sm" variant="ghost" onClick={reset}><RotateCcw className="h-4 w-4 mr-1" />Reset</Button>}
          </div>
        }
      />
      {showRegions && <RegionQuickFilter regions={regions} value={region} onChange={setRegionFilter} />}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric title="มูลค่างานที่คาดว่าจะปิด" value={formatTHB(closeValue)} note="Net RC" />
        <Metric title={isAE ? "มูลค่างานที่ยังเปิดอยู่ของฉัน" : isSM ? "มูลค่างานที่ยังเปิดอยู่ในภาค" : "มูลค่างานที่ยังเปิดอยู่"}
          value={formatTHB(sumValue(open))} note="Net RC"
          onClick={() => toPipeline({ status: "open", ...(isAE ? { owner: profile.id } : {}) })} />
        <Metric title="With Me"
          value={String(assigned.length)}
          note={isManagement ? "งานที่ส่งให้ฉัน · รวมทีม Management" : WORK_VIEW_SUBTITLES.with}
          onClick={() => toPipeline({ status: "open", ...withMeQuery })} />
        <Metric title={isManagement ? "Overdue" : "Overdue With Me"}
          value={String(isManagement ? overdue.length : assignedOverdue.length)} note={WORK_VIEW_SUBTITLES.overdue}
          onClick={() => toPipeline({ status: "open", stuck: "1", ...(!isManagement ? { handler: profile.id } : {}) })} />
      </div>
      <CloseStrip won={won} open={open} closeValue={closeValue} closeMonth={closeMonth}
        onWon={() => toPipeline({ status: "won", ...(isAE ? { owner: profile.id } : {}) })}
        onOpen={() => toPipeline({ status: "open", ...(isAE ? { owner: profile.id } : {}) })} />
      <div className={`grid grid-cols-1 gap-4 ${isManagement ? "lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"}`}>
        <Panel title={isManagement ? "งานที่ต้องดำเนินการ" : "งานที่ฉันรับผิดชอบ"} meta={queue.length + " Pipelines"}>
          <div className="flex flex-wrap gap-1.5 mb-3" aria-label="Work queue filters">
            {tabs.map(([id, label]) =>
              <button key={id} type="button" onClick={() => setQueueTab(id)}
                aria-pressed={selectedTab === id}
                className={selectedTab === id
                  ? "px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-primary bg-brand-tint text-brand"
                  : "px-2.5 py-1.5 text-[11px] rounded-lg border border-border hover:bg-secondary"}>
                <span className="block">{label}</span>
                <span className="block text-[10px] font-normal opacity-75">{id === "due" && closeMonth ? selectedCloseMonthSubtitle : WORK_VIEW_SUBTITLES[id]}</span>
              </button>
            )}
          </div>
          <OpportunityTable rows={queueItems} maps={maps}
            showRegion={isManagement || regionContext.showColumn}
            regionColumn={isManagement}
            onOpen={(id) => navigate("/opportunity/" + encodeURIComponent(id))} />
          <div className="pt-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={() =>
              toPipeline({
                status: "open",
                ...(selectedTab === "with" ? withMeQuery : {}),
                ...(selectedTab === "overdue" ? { stuck: "1", ...(!isManagement ? { handler: profile.id } : {}) } : {}),
                ...(selectedTab === "due" ? { due_this_month: "1" } : {}),
              })
            }>View All</Button>
          </div>
        </Panel>
        <Panel title="มูลค่างานแยกตาม Stage">
          <BarList rows={stageRows} onSelect={(id) => toPipeline({ status: "open", stage: id, ...(isAE ? { owner: profile.id } : {}) })} />
        </Panel>
      </div>
      {(isSM || isManagement) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel title={(isManagement || isSM) && !region && regions.length > 1 ? "มูลค่างานแยกตามภาค" : "มูลค่างานแยกตาม AE"} >
            <BreakdownTable rows={(isManagement || isSM) && !region && regions.length > 1 ? regionRows : ownerRows}
              label={(isManagement || isSM) && !region && regions.length > 1 ? "Region" : "AE Owner"}
              onSelect={(id) => (isManagement || isSM) && !region && regions.length > 1 ? setRegionFilter(id) : toPipeline({ status: "open", owner: id })} />
          </Panel>
          <Panel title="มูลค่างานแยกตามประเภทผลิตภัณฑ์" >
            <BarList rows={categoryRows} onSelect={(id) => toPipeline({ status: "open", product_category: id, ...(isAE ? { owner: profile.id } : {}) })} />
          </Panel>
        </div>
      )}
    </div>
  );
}

function Panel({ title, meta, children }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-soft min-w-0">
      <div className="flex justify-between items-center gap-3 mb-4">
        <h2 className="geo-panel-title">{title}</h2>
        {meta && <span className="text-[10px] text-muted-foreground shrink-0">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function Metric({ title, value, note, onClick }) {
  const children = <>
    <div className="geo-metric-label">{title}</div>
    <div className="geo-metric-value">{value}</div>
    <div className="geo-metric-note">{note}</div>
  </>;
  return onClick
    ? <button type="button" onClick={onClick}
        className="geo-metric-card rounded-xl border border-border bg-card p-4 text-left hover:border-brand/40 hover:bg-secondary/20 min-w-0">{children}</button>
    : <div className="geo-metric-card rounded-xl border border-border bg-card p-4 min-w-0">{children}</div>;
}

function CloseStrip({ won, open, closeValue, closeMonth, onWon, onOpen }) {
  const wonValue = sumValue(won);
  const openValue = sumValue(open);
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 flex flex-wrap items-center gap-4">
      <div className="min-w-[155px]">
        <div className="text-[12px] font-semibold">สรุปการปิดงาน</div>
        
      </div>
      <div className="flex-1 min-w-[160px]">
        <div className="flex gap-3 justify-between text-[11px] mb-2">
          <button className="hover:underline" onClick={onWon} type="button"><strong>Won</strong> {formatTHB(wonValue)} · {won.length}</button>
          <button className="hover:underline" onClick={onOpen} type="button"><strong>Open</strong> {formatTHB(openValue)} · {open.length}</button>
        </div>
        <div className="flex h-2 rounded-full bg-secondary overflow-hidden" aria-label="Won and Open Net RC">
          <div className="bg-emerald-600/75 h-full" style={{ width: (closeValue ? wonValue / closeValue * 100 : 0) + "%" }} />
          <div className="bg-brand/65 h-full" style={{ width: (closeValue ? openValue / closeValue * 100 : 0) + "%" }} />
        </div>
      </div>
    </div>
  );
}

function BarList({ rows, onSelect }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.some((r) => r.count)) return <EmptyRow />;
  return <div className="space-y-3">
    {rows.map((row) =>
      <button type="button" key={row.id} onClick={() => onSelect(row.id)} className="w-full text-left group rounded-md hover:bg-secondary/50 py-1">
        <div className="flex justify-between items-center gap-2 text-[12px] mb-1">
          <span className="font-medium group-hover:text-brand">{row.name}</span>
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{row.count} · {formatTHB(row.value)}</span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div className="h-full bg-brand/75 rounded-full" style={{ width: (row.value / max * 100) + "%" }} />
        </div>
      </button>
    )}
  </div>;
}

function BreakdownTable({ rows, label, onSelect }) {
  if (!rows.length) return <EmptyRow />;
  return <div className="overflow-x-auto">
    <table className="w-full text-[12px]">
      <thead><tr className="text-muted-foreground border-b border-border">
        <th className="text-left font-medium py-2">{label}</th>
        <th className="text-right font-medium py-2">Deals</th>
        <th className="text-right font-medium py-2">Net RC</th>
      </tr></thead>
      <tbody>{rows.map((row) =>
        <tr key={row.id} className="border-b last:border-0 border-border">
          <td className="py-3"><button type="button" className="font-medium text-left hover:text-brand hover:underline"
            onClick={() => onSelect(row.id)}>{row.name}</button></td>
          <td className="py-3 text-right tabular-nums">{row.count}</td>
          <td className="py-3 text-right tabular-nums font-medium">{formatTHB(row.value)}</td>
        </tr>
      )}</tbody>
    </table>
  </div>;
}

function OpportunityTable({ rows, maps, showRegion = false, regionColumn = false, onOpen }) {
  if (!rows.length) return <EmptyRow />;
  return <div className="overflow-x-auto">
    <table className={`w-full table-fixed text-[12px] ${regionColumn ? "min-w-[510px]" : "min-w-[390px]"}`}>
      <colgroup>
        <col style={{ width: regionColumn ? "40%" : "54%" }} />
        {regionColumn && <col style={{ width: "21%" }} />}
        <col style={{ width: regionColumn ? "15%" : "19%" }} />
        <col style={{ width: regionColumn ? "24%" : "27%" }} />
      </colgroup>
      <thead><tr className="text-muted-foreground border-b border-border">
        <th className="text-left font-medium py-2">Customer</th>
        {regionColumn && <th className="text-left font-medium py-2 pr-2">Region</th>}
        <th className="text-left font-medium py-2">Stage</th>
        <th className="text-right font-medium py-2">Net RC</th>
      </tr></thead>
      <tbody>{rows.map((o) =>
        <tr className="h-[76px] border-b border-border last:border-0" key={o.id}>
          <td className="py-2 pr-2 align-middle">
            <div className="flex min-h-[52px] flex-col justify-center">
              <button type="button" className="block max-w-full truncate text-left font-medium hover:text-brand hover:underline"
                title={o.customer_name} onClick={() => onOpen(o.id)}>{o.customer_name}</button>
              <div className="mt-0.5 flex min-h-[16px] flex-nowrap items-center gap-x-2 overflow-hidden whitespace-nowrap text-[10px] leading-4">
                {showRegion && !regionColumn && (
                  <span className="min-w-0 truncate text-muted-foreground">
                    {maps.region[o.region_id]?.name || o.region_id || "Unassigned Region"}
                  </span>
                )}
                </div>
            </div>
          </td>
          {regionColumn && <td className="py-2 pr-2 align-middle text-[11px] text-muted-foreground">
            <span className="block truncate" title={maps.region[o.region_id]?.name || o.region_id || "Unassigned Region"}>
              {maps.region[o.region_id]?.name || o.region_id || "Unassigned Region"}
            </span>
          </td>}
          <td className="py-2 align-middle text-muted-foreground whitespace-nowrap">{maps.stage[o.stage_id]?.name || "—"}</td>
          <td className="py-2 text-right align-middle font-medium tabular-nums whitespace-nowrap">{formatTHB(o.pipeline_value || 0)}</td>
        </tr>
      )}</tbody>
    </table>
  </div>;
}

function EmptyRow() {
  return <div className="text-[12px] text-muted-foreground py-7 text-center">No matching opportunities</div>;
}
