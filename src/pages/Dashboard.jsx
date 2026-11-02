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
import { pipelineStageDisplay } from "@/lib/pipelineStatusTabs";

import { legacyOpenStageRecords } from "@/lib/openStagePolicy";
import { Button } from "@/components/ui/button";
import { AlertCircle, RotateCcw, Settings2, Upload } from "lucide-react";

const sumValue = (items) => items.reduce((total, item) => total + (Number(item.pipeline_value) || 0), 0);
const isOpen = (item) => item.status === "open";
// Dashboard-only copy. Shared Pipeline quick-view labels are intentionally unchanged.
const DASHBOARD_VIEW_SUBTITLES = {
  with: "Pipeline ที่ส่งให้ฉัน",
  overdue: "Pipeline เกินกำหนด",
  due: "Pipeline ที่คาดว่าจะปิดเดือนนี้",
};
const DASHBOARD_SELECTED_CLOSE_MONTH_SUBTITLE = "Pipeline ที่คาดว่าจะปิดเดือนที่เลือก";
const DASHBOARD_STAGE_BADGE_TONES = {
  stage1: "border-[#B7E4C7] bg-[#ECFDF3] text-[#2F855A]",
  stage2: "border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]",
  stage3: "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]",
  stage4: "border-[#FBCFE8] bg-[#FDF2F8] text-[#BE185D]",
  review: "border-border bg-secondary text-foreground",
  won: "border-transparent bg-[#AFE0C2] text-[#166534]",
  lost: "border-transparent bg-[#F3C4C4] text-[#9A3340]",
  neutral: "border-border bg-secondary text-foreground",
};

export default function Dashboard() {
  const { scopedOpportunities, maps, master, activeStages, profile, config, taskEntries, loading, error, refresh } = useData();
  const navigate = useNavigate();
  const [createdMonth, setCreatedMonth] = useState("");
  const [closeMonth, setCloseMonth] = useState(() => currentMonthKey());
  const [regionFilter, setRegionFilter] = useState("");
  const [queueTab, setQueueTab] = useState("due");

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
  // Admin has no visible month picker; never apply an invisible default month filter.
  const effectiveCloseMonth = isAdmin ? "" : closeMonth;
  const cohort = dashboardCohort(scopedOpportunities, { createdMonth, closeMonth: effectiveCloseMonth, region });
  const regionContext = regionDisplayContext(cohort, maps.region, region, regions.map(r => r.id));
  // Assigned work may belong to a different AE; never credit it to this AE's sales.
  const sales = isAE ? cohort.filter((o) => o.owner_id === profile?.id) : cohort;
  const { open, won } = dashboardMetrics(sales, {
    stages: maps.stage, internalTaskSlaDays: config?.internal_task_sla_days,
  });
  const overdue = open.filter(o => overdueReasons(o, maps.stage, config?.stage_watch_days, taskEntries).any);
  const legacyStageOpen = legacyOpenStageRecords(open, activeStages);
  const assigned = withMePipelines(cohort, profile?.id, {
    role, teams: master?.WorkingWithOption,
  });
  const assignedOverdue = assigned.filter(o => overdueReasons(o, maps.stage, config?.stage_watch_days, taskEntries).any);
  const withMeQuery = isManagement ? { with_me: "1" } : { handler: profile?.id };

  const reset = () => { setCreatedMonth(""); setCloseMonth(""); setRegionFilter(""); setQueueTab("with"); };
  const hasFilters = Boolean(createdMonth || closeMonth || region);
  const params = (extra = {}) => ({
    ...(createdMonth ? { created_month: createdMonth } : {}),
    ...(effectiveCloseMonth ? { close_month: effectiveCloseMonth } : {}),
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

  const dueLabel = closeMonth && closeMonth !== currentMonthKey() ? "Due in Selected Month" : "Due This Month";
  const tabs = isManagement
    ? [["with", "With Me"], ["overdue", "Overdue"], ["due", dueLabel]]
    : isSM
      ? [["with", "With Me"], ["overdue", "Overdue With Me"], ["due", dueLabel]]
      : [["with", "With Me"], ["overdue", "Overdue With Me"], ["due", dueLabel]];
  const selectedTab = tabs.some(([id]) => id === queueTab) ? queueTab : "due";
  const queue = selectedTab === "with" ? assigned
    : selectedTab === "overdue" ? (isManagement ? overdue : assignedOverdue)
    : open.filter((o) => o.expected_close_month === (closeMonth || currentMonthKey()));
  const queueEmptyMessage = selectedTab === "with" ? "ไม่มี Pipeline ที่ส่งให้ฉัน"
    : selectedTab === "overdue" ? "ไม่มี Pipeline เกินกำหนด"
    : dueLabel === "Due This Month" ? "ไม่มี Pipeline ที่คาดว่าจะปิดเดือนนี้" : "ไม่มี Pipeline ที่คาดว่าจะปิดเดือนที่เลือก";
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
            {error ? actionableErrorMessage(error, "load") : "กำลังโหลดข้อมูล Pipeline…"}
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
          <Panel title="นำเข้า Pipeline"><p className="text-xs text-muted-foreground mb-3">ตรวจสอบและนำเข้าข้อมูล Pipeline</p>
            <Button type="button" variant="outline" onClick={() => navigate("/import")}><Upload className="h-4 w-4 mr-2" />Open Import</Button></Panel>
        </div>
        <Panel title="ภาพรวม Pipeline">
          <p className="text-sm text-muted-foreground">ดู Pipeline ได้ {cohort.length} รายการใน {regionContext.label} โดยด้านล่างแสดง Net RC ของ Pipeline ที่ยังเปิดอยู่แยกตามภาค</p>
          <Button type="button" variant="outline" className="mt-3" onClick={() => navigate("/pipeline")}>ดู Pipeline</Button>
        </Panel>
        <Panel title="มูลค่า Pipeline ที่ยังเปิดอยู่แยกตามภาค" meta="Open · Net RC">
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
        description={isAE ? "My overview" : isSM ? "Regional overview" : "Management overview"}
        actions={
          <div className="flex min-w-0 flex-wrap items-end gap-3">
          <div className="w-[150px]">
            <label className="geo-filter-label block mb-1.5">เดือนที่สร้าง</label>
            <MonthPicker value={createdMonth} onChange={setCreatedMonth} placeholder="All Months" allowAll />
          </div>
          <div className="w-[150px]">
            <label className="geo-filter-label block mb-1.5">เดือนที่คาดว่าจะปิด</label>
            <MonthPicker value={closeMonth} onChange={(month) => { setCloseMonth(month); if (!month) setQueueTab("with"); }} placeholder="All Months" allowAll />
          </div>
            {hasFilters && <Button size="sm" variant="ghost" onClick={reset}><RotateCcw className="h-4 w-4 mr-1" />Reset</Button>}
          </div>
        }
      />
      {showRegions && <RegionQuickFilter regions={regions} value={region} onChange={setRegionFilter} />}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric title="มูลค่า Pipeline รวม" value={formatTHB(closeValue)} note="Net RC · Open + Won" />
        <Metric title="มูลค่า Pipeline ที่เปิดอยู่"
          value={formatTHB(sumValue(open))}
          note={isAE ? "Net RC · ของฉัน" : isSM ? "Net RC · ในภาค" : "Net RC"}
          onClick={() => toPipeline({ status: "open", ...(isAE ? { owner: profile.id } : {}) })} />
        <Metric title="Pipeline ที่ส่งให้ฉัน"
          value={String(assigned.length)}
          note={isManagement ? "ของฉัน / ทีม Management" : "อยู่ในความรับผิดชอบ"}
          onClick={() => toPipeline({ status: "open", ...withMeQuery })} />
        <Metric title="Pipeline เกินกำหนด"
          value={String(isManagement ? overdue.length : assignedOverdue.length)} note="ต้องติดตาม"
          onClick={() => toPipeline({ status: "open", stuck: "1", ...(!isManagement ? { handler: profile.id } : {}) })} />
      </div>
      <CloseStrip won={won} open={open} closeValue={closeValue} closeMonth={closeMonth}
        onWon={() => toPipeline({ status: "won", ...(isAE ? { owner: profile.id } : {}) })}
        onOpen={() => toPipeline({ status: "open", ...(isAE ? { owner: profile.id } : {}) })} />
      <div className={`grid grid-cols-1 gap-4 ${isManagement ? "lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"}`}>
        <Panel title={isManagement ? "Pipeline ที่ต้องดำเนินการ" : "Pipeline ที่ฉันรับผิดชอบ"} meta={queue.length + " Pipelines"}>
          <div className="flex flex-wrap gap-1.5 mb-3" aria-label="Work queue filters">
            {tabs.map(([id, label]) =>
              <button key={id} type="button" onClick={() => setQueueTab(id)}
                aria-pressed={selectedTab === id}
                className={selectedTab === id
                  ? "px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-primary bg-brand-tint text-brand"
                  : "px-2.5 py-1.5 text-[11px] rounded-lg border border-border hover:bg-secondary"}>
                <span className="block">{label}</span>
                <span className="block text-[10px] font-normal opacity-75">{id === "due" && dueLabel !== "Due This Month" ? DASHBOARD_SELECTED_CLOSE_MONTH_SUBTITLE : DASHBOARD_VIEW_SUBTITLES[id]}</span>
              </button>
            )}
          </div>
          {isManagement && selectedTab === "with" && (
            <p className="mb-2 text-[11px] text-muted-foreground">
              Assigned to you or involving the Management team.
            </p>
          )}
          <OpportunityTable rows={queueItems} maps={maps} activeStages={activeStages} emptyMessage={queueEmptyMessage}
            showRegion={isManagement || regionContext.showColumn}
            regionColumn={isManagement}
            onOpen={(id) => navigate("/opportunity/" + encodeURIComponent(id))} />
          <div className="pt-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={() =>
              toPipeline({
                status: "open",
                ...(selectedTab === "with" ? withMeQuery : {}),
                ...(selectedTab === "overdue" ? { stuck: "1", ...(!isManagement ? { handler: profile.id } : {}) } : {}),
                ...(selectedTab === "due" && !closeMonth ? { due_this_month: "1" } : {}),
              })
            }>View All</Button>
          </div>
        </Panel>
        <Panel title="มูลค่า Pipeline แยกตาม Stage" meta="Open · Net RC">
          <BarList rows={stageRows} onSelect={(id) => toPipeline({ status: "open", stage: id, ...(isAE ? { owner: profile.id } : {}) })} />
          {legacyStageOpen.length > 0 && (
            <button type="button" onClick={() => navigate("/review-queue?tab=stage")}
              className="mt-3 inline-flex min-h-8 items-center gap-1.5 text-left text-xs font-medium text-foreground hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {legacyStageOpen.length} Pipeline รอตรวจสอบ Stage <span aria-hidden="true">→</span>
            </button>
          )}
        </Panel>
      </div>
      {(isSM || isManagement) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel title={(isManagement || isSM) && !region && regions.length > 1 ? "มูลค่า Pipeline แยกตามภาค" : "มูลค่า Pipeline แยกตาม AE"} meta="Open · Net RC">
            <BreakdownTable rows={(isManagement || isSM) && !region && regions.length > 1 ? regionRows : ownerRows}
              label={(isManagement || isSM) && !region && regions.length > 1 ? "Region" : "AE Owner"}
              onSelect={(id) => (isManagement || isSM) && !region && regions.length > 1 ? setRegionFilter(id) : toPipeline({ status: "open", owner: id })} />
          </Panel>
          <Panel title="มูลค่า Pipeline แยกตามประเภทผลิตภัณฑ์" meta="Open · Net RC">
            <BarList rows={categoryRows} onSelect={(id) => toPipeline({ status: "open", product_category: id, ...(isAE ? { owner: profile.id } : {}) })} />
          </Panel>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Metrics use the intersection of Created Month, Expected Close and permitted Region. Won is filtered by Expected Close, not by the actual Won date.
      </p>
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
    <div className="geo-metric-label truncate" title={title} style={{ fontSize: "13px", lineHeight: "18px", fontWeight: 600 }}>{title}</div>
    <div className="geo-metric-value">{value}</div>
    <div className="geo-metric-note">{note}</div>
  </>;
  return onClick
    ? <button type="button" onClick={onClick}
        className="rounded-xl border border-border bg-card p-4 text-left hover:border-brand/40 hover:bg-secondary/20 min-w-0">{children}</button>
    : <div className="rounded-xl border border-border bg-card p-4 min-w-0">{children}</div>;
}

function CloseStrip({ won, open, closeValue, closeMonth, onWon, onOpen }) {
  const wonValue = sumValue(won);
  const openValue = sumValue(open);
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 flex flex-wrap items-center gap-4">
      <div className="min-w-[155px]">
        <div className="text-[12px] font-semibold">สถานะ Pipeline</div>
        <div className="text-[10px] text-muted-foreground">{closeMonth ? "Expected Close · Selected Month" : "Expected Close · All Months"}</div>
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
  return <div className="space-y-2">
    {rows.map((row) =>
      <button type="button" key={row.id} onClick={() => onSelect(row.id)} className="w-full text-left group rounded-md hover:bg-secondary/50 py-0.5">
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
        <th className="text-right font-medium py-2">Pipelines</th>
        <th className="text-right font-medium py-1.5">Net RC</th>
      </tr></thead>
      <tbody>{rows.map((row) =>
        <tr key={row.id} className="border-b last:border-0 border-border">
          <td className="py-2"><button type="button" className="font-medium text-left hover:text-brand hover:underline"
            onClick={() => onSelect(row.id)}>{row.name}</button></td>
          <td className="py-2 text-right tabular-nums">{row.count}</td>
          <td className="py-2 text-right tabular-nums font-medium">{formatTHB(row.value)}</td>
        </tr>
      )}</tbody>
    </table>
  </div>;
}

function OpportunityTable({ rows, maps, activeStages = [], showRegion = false, regionColumn = false, emptyMessage = "ไม่มี Pipeline ในรายการนี้", onOpen }) {
  if (!rows.length) return <EmptyRow message={emptyMessage} />;
  return <div className="overflow-x-auto">
    <table className={`w-full table-fixed text-[12px] ${regionColumn ? "min-w-[560px]" : "min-w-[410px]"}`}>
      <colgroup>
        {/* Give customer names the remaining space without stretching Stage/Net RC. */}
        <col />
        {regionColumn && <col className="w-[118px]" />}
        <col className="w-[106px]" />
        <col className="w-[116px]" />
      </colgroup>
      <thead><tr className="border-b border-border text-muted-foreground">
        <th className="py-1.5 text-left font-medium">Customer</th>
        {regionColumn && <th className="py-1.5 pr-2 text-left font-medium">Region</th>}
        <th className="py-1.5 text-left font-medium">Stage</th>
        <th className="py-1.5 text-right font-medium">Net RC</th>
      </tr></thead>
      <tbody>{rows.map((o) => {
        const stageDisplay = pipelineStageDisplay(o, activeStages, maps.stage);
        return (
          <tr className="h-[52px] border-b border-border last:border-0" key={o.id}>
            <td className="py-2 pr-2 align-middle">
              <div className="flex min-w-0 flex-col justify-center gap-0.5">
                <button type="button" className="block w-full min-w-0 truncate text-left font-medium leading-5 hover:text-brand hover:underline"
                  title={o.customer_name} onClick={() => onOpen(o.id)}>{o.customer_name}</button>
                {showRegion && !regionColumn && (
                  <span className="block min-w-0 truncate text-[10px] leading-4 text-muted-foreground">
                    {maps.region[o.region_id]?.name || o.region_id || "Unassigned Region"}
                  </span>
                )}
              </div>
            </td>
            {regionColumn && (
              <td className="py-2 pr-2 align-middle text-[11px] text-muted-foreground">
                <span className="block truncate" title={maps.region[o.region_id]?.name || o.region_id || "Unassigned Region"}>
                  {maps.region[o.region_id]?.name || o.region_id || "Unassigned Region"}
                </span>
              </td>
            )}
            <td className="py-2 align-middle">
              <span title={stageDisplay.label}
                className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-[18px] ${DASHBOARD_STAGE_BADGE_TONES[stageDisplay.tone] || DASHBOARD_STAGE_BADGE_TONES.neutral}`}>
                <span className="min-w-0 truncate">{stageDisplay.label}</span>
              </span>
            </td>
            <td className="py-2 text-right align-middle font-medium tabular-nums whitespace-nowrap">{formatTHB(o.pipeline_value || 0)}</td>
          </tr>
        );
      })}</tbody>
    </table>
  </div>;
}

function EmptyRow({ message = "ไม่มี Pipeline ในรายการนี้" }) {
  return <div className="text-[12px] text-muted-foreground py-7 text-center">{message}</div>;
}
