import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "@/lib/dataContext";
import { db } from "@/api/client";
import { formatNetRc as formatTHB } from "@/lib/netRc";
import { ROLE_LABELS, currentMonthKey } from "@/lib/pipeline";
import { dashboardCohort, dashboardMetrics, isStageSlaOverdue } from "@/lib/dashboardMetrics";
import MonthPicker from "@/components/MonthPicker";
import RegionQuickFilter from "@/components/dashboard/RegionQuickFilter";
import { regionDisplayContext } from "@/lib/pipelineListPresentation";
import {filterSupportRequests} from "@/lib/supportQueue";
import { Button } from "@/components/ui/button";
import { AlertCircle, RotateCcw, Settings2, Upload } from "lucide-react";

const sumValue = (items) => items.reduce((total, item) => total + (Number(item.pipeline_value) || 0), 0);
const isOpen = (item) => item.status === "open";
const compactDate = (month) => month || "All Months";

export default function Dashboard() {
  const { scopedOpportunities, maps, activeStages, profile, config, loading, error, refresh } = useData();
  const navigate = useNavigate();
  const [createdMonth, setCreatedMonth] = useState("");
  const [closeMonth, setCloseMonth] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [queueTab, setQueueTab] = useState("unassigned");
  const [supportRequests, setSupportRequests] = useState(null);
  const [supportError, setSupportError] = useState("");

  const role = profile?.app_role || "ae";
  const isAdmin = role === "admin";
  const isManagement = role === "management";
  const isSM = role === "sm";
  const isAE = role === "ae";

  // UI filters are not access controls: all charts begin with server-scoped opportunities.
  const regions = useMemo(
    () => Object.values(maps.region || {}).filter((r) => r.active)
      .filter((r) => isAdmin || (profile?.region_ids || []).includes(r.id))
      .sort((a, b) => (a.order || 0) - (b.order || 0)),
    [maps.region, profile?.region_ids, isAdmin]
  );
  const region = regions.some((r) => r.id === regionFilter) ? regionFilter : "";
  // The same context rule applies to AE, SM, Management, and Admin.
  const showRegions = regions.length > 1;
  const cohort = dashboardCohort(scopedOpportunities, { createdMonth, closeMonth, region });
  const regionContext = regionDisplayContext(cohort, maps.region, region, regions.map(r => r.id));
  // Assigned work may belong to a different AE; never credit it to this AE's sales.
  const sales = isAE ? cohort.filter((o) => o.owner_id === profile?.id) : cohort;
  const { open, won, supportNeeded, stageOverdue } = dashboardMetrics(sales, {
    stages: maps.stage, internalTaskSlaDays: config?.internal_task_sla_days,
  });
  const assigned = cohort.filter((o) => isOpen(o) && o.current_handler_id === profile?.id);
  const assignedOverdue = assigned.filter((o) => isStageSlaOverdue(o, maps.stage));

  // Management requests are tasks, not Pipeline Current Handler assignments.
  useEffect(() => {
    if (!isManagement || !profile?.id) {
      return;
    }
    setSupportRequests(null);
    setSupportError("");
    let active = true;
    db.supportRequests.list()
      .then((items) => {
        if (active) {
          setSupportRequests(Array.isArray(items) ? items : []);
          setSupportError("");
        }
      })
      .catch(() => {
        if (active) {
          setSupportRequests(null);
          setSupportError("Unable to load assigned support requests.");
        }
      });
    return () => { active = false; };
  }, [isManagement, profile?.id]);

  const visibleRequests = (supportRequests || []).filter((request) =>
    (!region || request.region_id === region) &&
    cohort.some((o) => o.id === request.opportunity_id)
  );
  const myRequests = filterSupportRequests(visibleRequests, "mine", profile?.id);
  const unassignedRequests = filterSupportRequests(visibleRequests, "unassigned", profile?.id);
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
    ? [["unassigned", "Unassigned (" + (supportRequests === null ? "…" : unassignedRequests.length) + ")"], ["with", "With Me"], ["overdue", "Stage Overdue"], ["support", "Needs Support"], ["due", closeMonth ? "Due in Selected Month" : "Due This Month"]]
    : isSM
      ? [["with", "With Me"], ["overdue", "Overdue With Me"], ["support", "Needs Support"], ["due", closeMonth ? "Due in Selected Month" : "Due This Month"]]
      : [["with", "With Me"], ["overdue", "Overdue With Me"], ["due", closeMonth ? "Due in Selected Month" : "Due This Month"]];
  const selectedTab = tabs.some(([id]) => id === queueTab) ? queueTab : "with";
  const queue = selectedTab === "with" ? assigned
    : selectedTab === "overdue" ? (isManagement ? stageOverdue : assignedOverdue)
    : selectedTab === "support" ? supportNeeded
    : open.filter((o) => o.expected_close_month === (closeMonth || currentMonthKey()));
  const queueItems = queue.slice().sort((a, b) => {
    const aTime = new Date(a.stage_entered_at || 0).getTime();
    const bTime = new Date(b.stage_entered_at || 0).getTime();
    return aTime - bTime;
  }).slice(0, 8);
  const closeValue = sumValue(won) + sumValue(open);

  if (loading || error) {
    return (
      <div className="p-5 md:p-7 max-w-[1400px] mx-auto">
        <h1 className="text-[22px] font-semibold mb-5">Dashboard</h1>
        <div role={error ? "alert" : "status"} className="rounded-xl border border-border bg-card p-4 flex gap-3 items-center">
          <AlertCircle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <div className="flex-1 text-sm">
            {error ? "Unable to load Pipeline data. " + error.message : "Loading Pipeline data…"}
          </div>
          {error && <Button type="button" variant="outline" onClick={refresh}>Retry</Button>}
        </div>
      </div>
    );
  }

  if (isAdmin) {
    return (
      <div className="p-5 md:p-7 max-w-[1400px] mx-auto space-y-4">
        <div><h1 className="text-[22px] font-semibold">Data & Access</h1>
          <p className="text-sm text-muted-foreground mt-1">Admin workspace · {regionContext.label}</p></div>
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
        <Panel title="Open Pipeline by Region" meta="Open · Net RC">
          <BreakdownTable rows={regionRows} label="Region"
            onSelect={(id) => toPipeline({ status: "open", region: id })} />
        </Panel>
      </div>
    );
  }

  return (
    <div className="p-5 md:p-7 max-w-[1400px] mx-auto space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">
            {isAE ? "My Dashboard" : isSM ? "Regional Dashboard" : "Management Dashboard"}
          </h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {ROLE_LABELS[role]} · {isAE ? "Owned sales and assigned work" : "Authorized regions only"}
            <span className="mx-2" aria-hidden="true">·</span>
            <span aria-label={"Region scope: " + regionContext.label}>{regionContext.label}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="w-[150px]">
            <label className="text-[11px] font-medium text-muted-foreground block mb-1.5">Created Month</label>
            <MonthPicker value={createdMonth} onChange={setCreatedMonth} placeholder="All Months" allowAll />
          </div>
          <div className="w-[150px]">
            <label className="text-[11px] font-medium text-muted-foreground block mb-1.5">Expected Close</label>
            <MonthPicker value={closeMonth} onChange={setCloseMonth} placeholder="All Months" allowAll />
          </div>
          {hasFilters && <Button size="sm" variant="ghost" onClick={reset}><RotateCcw className="h-4 w-4 mr-1" />Reset</Button>}
        </div>
      </div>
      {showRegions && <RegionQuickFilter regions={regions} value={region} onChange={setRegionFilter} />}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric title="Close Outlook" value={formatTHB(closeValue)} note="Won + Open (selected filters)" />
        <Metric title={isAE ? "My Open Pipeline" : isSM ? "Region Open Pipeline" : "Open Pipeline"}
          value={formatTHB(sumValue(open))} note={open.length + " opportunities"}
          onClick={() => toPipeline({ status: "open", ...(isAE ? { owner: profile.id } : {}) })} />
        <Metric title="With Me"
          value={isManagement ? (supportError ? "—" : supportRequests === null ? "…" : String(myRequests.length)) : String(assigned.length)}
          note={isManagement ? "Assigned support requests" : "Current Handler"}
          onClick={() => isManagement ? navigate("/support-requests") : toPipeline({ status: "open", handler: profile.id })} />
        <Metric title={isManagement ? "Stage Overdue" : "Overdue With Me"}
          value={String(isManagement ? stageOverdue.length : assignedOverdue.length)} note="Beyond configured Stage SLA"
          onClick={() => toPipeline({ status: "open", stuck: "1", ...(!isManagement ? { handler: profile.id } : {}) })} />
      </div>
      <CloseStrip won={won} open={open} closeValue={closeValue} closeMonth={closeMonth}
        onWon={() => toPipeline({ status: "won", ...(isAE ? { owner: profile.id } : {}) })}
        onOpen={() => toPipeline({ status: "open", ...(isAE ? { owner: profile.id } : {}) })} />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-4">
        <Panel title={isManagement ? "Action Queue" : "My Assigned Work"} meta={isManagement && (selectedTab === "with" || selectedTab === "unassigned") ? "Support Requests" : queue.length + " opportunities"}>
          <div className="flex flex-wrap gap-1.5 mb-3" aria-label="Work queue filters">
            {tabs.map(([id, label]) =>
              <button key={id} type="button" onClick={() => setQueueTab(id)}
                aria-pressed={selectedTab === id}
                className={selectedTab === id
                  ? "px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-primary bg-brand-tint text-brand"
                  : "px-2.5 py-1.5 text-[11px] rounded-lg border border-border hover:bg-secondary"}>
                {label}
              </button>
            )}
          </div>
          {isManagement && (selectedTab === "with" || selectedTab === "unassigned")
            ? <div>
                {supportError && <p role="alert" className="text-xs text-destructive mb-2">{supportError}</p>}
                {supportRequests === null && !supportError && <p className="text-xs text-muted-foreground">Loading assigned requests…</p>}
                {(selectedTab === "unassigned" ? unassignedRequests : myRequests).slice(0, 8).map((request) =>
                  <button key={request.request_id} className="w-full text-left flex justify-between gap-2 border-b border-border py-3 hover:bg-secondary/50"
                    onClick={() => navigate("/support-requests?view=" + (selectedTab === "unassigned" ? "unassigned" : "mine"))}>
                    <span className="min-w-0"><span className="block font-medium text-[12px]">{request.opportunity_id}</span>
                      <span className="block text-[11px] text-muted-foreground">{request.note || "Support request"}</span></span>
                    <span className="text-[10px] text-muted-foreground shrink-0 text-right">
                      {regionContext.showColumn && <span className="block">{maps.region[request.region_id]?.name || request.region_id}</span>}
                      {request.status}
                    </span>
                  </button>
                )}
                {supportRequests !== null && !(selectedTab === "unassigned" ? unassignedRequests : myRequests).length && <EmptyRow />}
              </div>
            : <OpportunityTable rows={queueItems} maps={maps} showRegion={regionContext.showColumn} onOpen={(id) => navigate("/opportunity/" + encodeURIComponent(id))} />}
          <div className="pt-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={() =>
              isManagement && (selectedTab === "with" || selectedTab === "unassigned") ? navigate("/support-requests?view=" + (selectedTab === "unassigned" ? "unassigned" : "mine")) :
                toPipeline({
                  status: "open",
                  ...(selectedTab === "with" ? { handler: profile.id } : {}),
                  ...(selectedTab === "overdue" ? { stuck: "1", ...(!isManagement ? { handler: profile.id } : {}) } : {}),
                  ...(selectedTab === "support" ? { support: "1" } : {}),
                })
            }>View All</Button>
          </div>
        </Panel>
        <Panel title="Pipeline by Stage" meta="Open · Net RC">
          <BarList rows={stageRows} onSelect={(id) => toPipeline({ status: "open", stage: id, ...(isAE ? { owner: profile.id } : {}) })} />
        </Panel>
      </div>
      {(isSM || isManagement) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel title={(isManagement || isSM) && !region && regions.length > 1 ? "Pipeline by Region" : "Pipeline by AE Owner"} meta="Open · Net RC">
            <BreakdownTable rows={(isManagement || isSM) && !region && regions.length > 1 ? regionRows : ownerRows}
              label={(isManagement || isSM) && !region && regions.length > 1 ? "Region" : "AE Owner"}
              onSelect={(id) => (isManagement || isSM) && !region && regions.length > 1 ? setRegionFilter(id) : toPipeline({ status: "open", owner: id })} />
          </Panel>
          <Panel title="Pipeline by Product Category" meta="Open · Net RC">
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
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {meta && <span className="text-[10px] text-muted-foreground shrink-0">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function Metric({ title, value, note, onClick }) {
  const children = <>
    <div className="text-[11px] text-muted-foreground font-medium">{title}</div>
    <div className="text-[22px] leading-7 font-semibold tabular-nums mt-2">{value}</div>
    <div className="text-[11px] text-muted-foreground mt-1">{note}</div>
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
        <div className="text-[12px] font-semibold">Close Summary</div>
        <div className="text-[10px] text-muted-foreground">{closeMonth ? "Selected Expected Close Month" : "All Expected Close Months"}</div>
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

function OpportunityTable({ rows, maps, showRegion = false, onOpen }) {
  if (!rows.length) return <EmptyRow />;
  return <div className="overflow-x-auto"><table className="w-full text-[12px]">
    <thead><tr className="text-muted-foreground border-b border-border">
      <th className="text-left font-medium py-2">Customer</th>
      <th className="text-left font-medium py-2">Stage</th>
      <th className="text-right font-medium py-2">Net RC</th>
    </tr></thead>
    <tbody>{rows.map((o) =>
      <tr className="border-b border-border last:border-0" key={o.id}>
        <td className="py-3 pr-2"><button type="button" className="font-medium text-left hover:text-brand hover:underline"
          onClick={() => onOpen(o.id)}>{o.customer_name}</button>
          {showRegion && <div className="text-[10px] text-muted-foreground mt-0.5">{maps.region[o.region_id]?.name || o.region_id || "Unassigned Region"}</div>}
          {o.support_needed && <div className="text-[10px] text-amber-700">Needs Support</div>}
        </td>
        <td className="py-3 text-muted-foreground whitespace-nowrap">{maps.stage[o.stage_id]?.name || "—"}</td>
        <td className="py-3 text-right font-medium tabular-nums whitespace-nowrap">{formatTHB(o.pipeline_value || 0)}</td>
      </tr>
    )}</tbody>
  </table></div>;
}

function EmptyRow() {
  return <div className="text-[12px] text-muted-foreground py-7 text-center">No matching opportunities</div>;
}
