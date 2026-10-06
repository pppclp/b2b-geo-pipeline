import React, { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { useData } from "@/lib/dataContext";
import { formatTHB, formatMonth, agingDays, formatDate, STATUS_LABELS } from "@/lib/pipeline";
import PipelineCard from "@/components/PipelineCard";
import FilterBar from "@/components/FilterBar";
import OpportunityForm from "@/components/OpportunityForm";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KanbanSquare, List, Plus, Download } from "lucide-react";

const SORTS = [
  { value: "close_month", label: "Expected Close Month" },
  { value: "value_desc", label: "Value — High to Low" },
  { value: "value_asc", label: "Value — Low to High" },
  { value: "stage_aging_desc", label: "Stage Aging — Longest First" },
  { value: "handler_aging_desc", label: "Handler Aging — Longest First" },
  { value: "updated_desc", label: "Recently Updated" },
  { value: "created_desc", label: "Created Date" },
  { value: "customer_asc", label: "Customer Name A-Z" },
  { value: "support_first", label: "Support Needed First" },
];

function applySort(ops, sort) {
  const arr = [...ops];
  switch (sort) {
    case "value_desc": return arr.sort((a, b) => (b.pipeline_value || 0) - (a.pipeline_value || 0));
    case "value_asc": return arr.sort((a, b) => (a.pipeline_value || 0) - (b.pipeline_value || 0));
    case "stage_aging_desc": return arr.sort((a, b) => agingDays(b.stage_entered_at) - agingDays(a.stage_entered_at));
    case "handler_aging_desc": return arr.sort((a, b) => agingDays(b.handler_since) - agingDays(a.handler_since));
    case "updated_desc": return arr.sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date));
    case "created_desc": return arr.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    case "customer_asc": return arr.sort((a, b) => (a.customer_name || "").localeCompare(b.customer_name || ""));
    case "support_first": return arr.sort((a, b) => (b.support_needed ? 1 : 0) - (a.support_needed ? 1 : 0));
    case "close_month":
    default: return arr.sort((a, b) => (a.expected_close_month || "9999").localeCompare(b.expected_close_month || "9999"));
  }
}

function exportCSV(ops, maps) {
  const headers = [
    "Opportunity ID", "Customer Name", "Business ID", "Customer Type", "Scenario",
    "Region", "Territory", "Opportunity Owner", "Current Handler",
    "Product Category", "Product", "Stage", "Status",
    "Created At", "Created Month", "Expected Close Month", "Pipeline Value",
    "Stage Aging (days)", "Handler Aging (days)",
    "Working With", "Working With Aging (days)",
    "Support Needed", "Support Type", "Support Note",
    "Won At", "Lost At", "Lost Reason", "Lost Note",
    "Created By", "Updated At",
  ];
  const rows = ops.map((o) => [
    o.id, o.customer_name, o.business_id || "", o.customer_type || "",
    maps.scenario[o.scenario_id]?.name || "",
    maps.region[o.region_id]?.name || "", maps.territory[o.territory_id]?.name || "",
    maps.member[o.owner_id]?.name || "", maps.member[o.current_handler_id]?.name || "",
    maps.category[o.product_category_id]?.name || "", maps.product[o.product_id]?.name || "",
    maps.stage[o.stage_id]?.name || "", STATUS_LABELS[o.status] || o.status,
    formatDate(o.created_date), o.created_month || "", formatMonth(o.expected_close_month), o.pipeline_value || 0,
    agingDays(o.stage_entered_at), agingDays(o.handler_since),
    o.working_with || "", o.working_with ? agingDays(o.working_with_since) : "",
    o.support_needed ? "Yes" : "No", o.support_type || "", o.support_note || "",
    formatDate(o.won_at), formatDate(o.lost_at), maps.lostReason[o.lost_reason_id]?.name || "", o.lost_note || "",
    maps.member[o.created_by_id]?.name || "", formatDate(o.updated_date),
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pipeline_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Pipeline() {
  const { scopedOpportunities, activeStages, maps, profile, moveStage } = useData();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState("board");
  const [sort, setSort] = useState("close_month");
  const [formOpen, setFormOpen] = useState(false);
  const [filters, setFilters] = useState({ status: "open" });

  // Hydrate filters from URL params
  useEffect(() => {
    const f = { status: "open" };
    if (params.get("assigned") === "me") f.handler = profile?.id;
    if (params.get("support") === "1") f.support = "1";
    if (params.get("region")) f.region = params.get("region");
    if (params.get("owner")) f.owner = params.get("owner");
    if (params.get("handler")) f.handler = params.get("handler");
    if (params.get("category")) f.product_category = params.get("category");
    if (params.get("product")) f.product = params.get("product");
    if (params.get("close_month")) f.close_month = params.get("close_month");
    if (params.get("created_month")) f.created_month = params.get("created_month");
    if (params.get("stage")) f.stage = params.get("stage");
    if (params.get("status")) f.status = params.get("status");
    setFilters(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, profile?.id]);

  const onFilter = (key, value) => {
    if (key === "clear") {
      setFilters({ status: "open" });
      setParams({});
      return;
    }
    setFilters((f) => ({ ...f, [key]: value || "" }));
  };

  const filtered = useMemo(() => {
    return scopedOpportunities.filter((o) => {
      if (filters.created_month && o.created_month !== filters.created_month) return false;
      if (filters.close_month && o.expected_close_month !== filters.close_month) return false;
      if (filters.region && o.region_id !== filters.region) return false;
      if (filters.owner && o.owner_id !== filters.owner) return false;
      if (filters.handler && o.current_handler_id !== filters.handler) return false;
      if (filters.stage && o.stage_id !== filters.stage) return false;
      if (filters.status && o.status !== filters.status) return false;
      if (filters.product_category && o.product_category_id !== filters.product_category) return false;
      if (filters.product && o.product_id !== filters.product) return false;
      if (filters.scenario && o.scenario_id !== filters.scenario) return false;
      if (filters.working_with && o.working_with !== filters.working_with) return false;
      if (filters.support === "1" && !o.support_needed) return false;
      if (filters.support === "0" && o.support_needed) return false;
      return true;
    });
  }, [scopedOpportunities, filters]);

  const sorted = useMemo(() => applySort(filtered, sort), [filtered, sort]);

  const onDragEnd = (res) => {
    if (!res.destination) return;
    const opId = res.draggableId;
    const destStageId = res.destination.droppableId;
    moveStage(opId, destStageId, "");
  };

  const totalValue = sorted.reduce((a, o) => a + (o.pipeline_value || 0), 0);

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">Pipeline</h1>
          <p className="text-sm text-muted-foreground">{sorted.length} opportunities · {formatTHB(totalValue)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCSV(sorted, maps)}>
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> New Opportunity
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-3 mb-4">
        <FilterBar filters={filters} onFilter={onFilter} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setView("board")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${view === "board" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"}`}
          >
            <KanbanSquare className="w-4 h-4" /> Board
          </button>
          <button
            onClick={() => setView("list")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${view === "list" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"}`}
          >
            <List className="w-4 h-4" /> List
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort</span>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-[200px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="No opportunities match" description="Try adjusting filters or create a new opportunity." icon={KanbanSquare} />
      ) : view === "board" ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {activeStages.map((stage) => {
              const stageOps = sorted.filter((o) => o.stage_id === stage.id);
              const stageValue = stageOps.reduce((a, o) => a + (o.pipeline_value || 0), 0);
              return (
                <div key={stage.id} className="flex flex-col w-72 shrink-0">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="font-medium text-sm">{stage.name}</span>
                    <span className="text-xs text-muted-foreground">{stageOps.length} · {formatTHB(stageValue)}</span>
                  </div>
                  <Droppable droppableId={stage.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`flex-1 space-y-2 p-2 rounded-lg min-h-[120px] transition-colors ${snapshot.isDraggingOver ? "bg-secondary" : "bg-secondary/40"}`}
                      >
                        {stageOps.map((op, idx) => (
                          <Draggable key={op.id} draggableId={op.id} index={idx}>
                            {(p) => (
                              <div ref={p.innerRef} {...p.draggableProps} {...p.dragHandleProps}>
                                <PipelineCard op={op} />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {stageOps.length === 0 && (
                          <div className="text-xs text-muted-foreground text-center py-6">Drop here</div>
                        )}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Customer</th>
                  <th className="text-left font-medium px-3 py-2">Product</th>
                  <th className="text-left font-medium px-3 py-2">Stage</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                  <th className="text-left font-medium px-3 py-2">Owner</th>
                  <th className="text-left font-medium px-3 py-2">Handler</th>
                  <th className="text-right font-medium px-3 py-2">Value</th>
                  <th className="text-left font-medium px-3 py-2">Close</th>
                  <th className="text-right font-medium px-3 py-2">Stage Age</th>
                  <th className="text-left font-medium px-3 py-2">Support</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((o) => (
                  <tr key={o.id} className="border-t border-border hover:bg-secondary/30 cursor-pointer" onClick={() => (window.location.href = `#/opportunity/${o.id}`)}>
                    <td className="px-3 py-2 font-medium">{o.customer_name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{maps.category[o.product_category_id]?.name}{o.product_id ? ` · ${maps.product[o.product_id]?.name}` : ""}</td>
                    <td className="px-3 py-2">{maps.stage[o.stage_id]?.name}</td>
                    <td className="px-3 py-2">{STATUS_LABELS[o.status]}</td>
                    <td className="px-3 py-2">{maps.member[o.owner_id]?.name}</td>
                    <td className="px-3 py-2">{maps.member[o.current_handler_id]?.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatTHB(o.pipeline_value)}</td>
                    <td className="px-3 py-2">{formatMonth(o.expected_close_month)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{agingDays(o.stage_entered_at)}d</td>
                    <td className="px-3 py-2">{o.support_needed ? <span className="text-amber-600">Yes</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <OpportunityForm open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
}