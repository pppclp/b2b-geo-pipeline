import React, { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/dataContext";
import { formatNetRc } from "@/lib/netRc";
import { formatMonth, agingDays, STATUS_LABELS } from "@/lib/pipeline";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Maximize2 } from "lucide-react";
import WorkingWithMultiSelect from "@/components/WorkingWithMultiSelect";
import SupportToggleAction from "@/components/SupportToggleAction";
import PipelineCloseActions from "@/components/PipelineCloseActions";

const NONE = "__none__";
const textOrDash = (value) => value || "—";

/**
 * Shared Stage / Handler / Working With controls.
 * One Save issues a single Opportunity update; timers reset only when their
 * respective field changes. Used by Quick View and Full Detail page.
 */
export function PipelineQuickActions({ op, initialStageId, onSaved, onCancel, onDirtyChange }) {
  const { master, maps, activeStages, profile, updateQuickActions } = useData();
  const [stageId, setStageId] = useState(initialStageId || op.stage_id);
  const [handlerId, setHandlerId] = useState(op.current_handler_id || "");
  const [workingWith, setWorkingWith] = useState(op.working_with || "");
  const [workingTeamIds, setWorkingTeamIds] = useState(op.working_with_team_ids || (master?.WorkingWithOption || []).find(t=>t.name===op.working_with)?.id || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setStageId(initialStageId || op.stage_id);
    setHandlerId(op.current_handler_id || "");
    setWorkingWith(op.working_with || "");
    setWorkingTeamIds(op.working_with_team_ids || (master?.WorkingWithOption || []).find(t=>t.name===op.working_with)?.id || "");
    setError("");
  }, [op.id, initialStageId, op.stage_id, op.current_handler_id, op.working_with]);

  const canEdit = op.status === "open" && (
    profile?.app_role === "admin" ||
    profile?.app_role === "sm" || profile?.app_role === "management" ||
    (profile?.app_role === "ae" && (op.owner_id === profile?.id || op.current_handler_id === profile?.id))
  );

  const handlerOptions = useMemo(() => {
    const allowed = (master?.TeamMember || []).filter((member) => {
      if (!member.active) return false;
      // Handoffs run AE <-> SM within this Pipeline's Region.
      if (member.id === op.current_handler_id || member.id === op.owner_id) return true;
      return member.app_role === "sm" && (member.region_ids || []).includes(op.region_id);
    });
    const seen = new Set(allowed.map((member) => member.id));
    for (const id of [op.owner_id, op.current_handler_id]) {
      const legacy = maps.member?.[id];
      if (legacy && !seen.has(id)) { allowed.push(legacy); seen.add(id); }
    }
    return allowed.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [master, maps.member, op.owner_id, op.current_handler_id, op.region_id]);

  const workingOptions = useMemo(() => {
    const items = (master?.WorkingWithOption || []).filter((item) => item.active).map((item) => item.name);
    if (op.working_with && !items.includes(op.working_with)) items.push(op.working_with);
    return Array.from(new Set(items)).sort();
  }, [master, op.working_with]);

  const changed = stageId !== op.stage_id ||
    handlerId !== (op.current_handler_id || "") ||
    workingWith !== (op.working_with || "") ||
    workingTeamIds !== (op.working_with_team_ids || (master?.WorkingWithOption || []).find(t=>t.name===op.working_with)?.id || "");
  const hasPending = Boolean(initialStageId && initialStageId !== op.stage_id);
  useEffect(() => { onDirtyChange?.(changed); }, [changed, onDirtyChange]);

  const save = async (event) => {
    event.preventDefault();
    if (!canEdit || !changed || saving || !stageId || !handlerId) return;
    setSaving(true);
    setError("");
    try {
      await updateQuickActions(op.id, { stageId, handlerId, workingWith, workingTeamIds });
      onSaved?.();
    } catch (err) {
      setError(err?.message || "Unable to save Pipeline changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">Stage Progress</h3>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(activeStages.length, 1)}, minmax(0, 1fr))` }}>
          {activeStages.map((stage, index) => {
            const position = activeStages.findIndex((item) => item.id === stageId);
            return (
              <div key={stage.id} className="min-w-0">
                <div className={`h-1 rounded-full ${index <= position ? "bg-red-600" : "bg-secondary"}`} />
                <div className={`mt-1.5 truncate text-[10px] ${index === position ? "font-semibold text-foreground" : "text-muted-foreground"}`} title={stage.name}>{stage.name}</div>
              </div>
            );
          })}
        </div>
      </div>
      {hasPending && <p className="text-xs text-amber-700">Stage change pending confirmation</p>}
      <div className="border-t border-border/70 divide-y divide-border/70">
        <div className="flex items-center gap-4 py-3">
          <div className="min-w-0 flex-1">
            <Label htmlFor={`stage-${op.id}`} className="text-[13px] font-medium">Current Stage</Label>
            <p className="text-xs text-muted-foreground mt-1">Stage Aging · {agingDays(op.stage_entered_at)} days</p>
          </div>
          <div className="w-[48%] shrink-0">
            <Select disabled={!canEdit || saving} value={stageId} onValueChange={setStageId}>
              <SelectTrigger id={`stage-${op.id}`} className="w-full"><SelectValue placeholder="Select Stage" /></SelectTrigger>
              <SelectContent>{activeStages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-4 py-3">
          <div className="min-w-0 flex-1">
            <Label htmlFor={`handler-${op.id}`} className="text-[13px] font-medium">Current Handler</Label>
            <p className="text-xs text-muted-foreground mt-1">Handler Aging · {agingDays(op.handler_since)} days</p>
          </div>
          <div className="w-[48%] shrink-0">
            <Select disabled={!canEdit || saving} value={handlerId} onValueChange={setHandlerId}>
              <SelectTrigger id={`handler-${op.id}`} className="w-full"><SelectValue placeholder="Select Handler" /></SelectTrigger>
              <SelectContent>{handlerOptions.map((member) => <SelectItem key={member.id} value={member.id}>{member.name} · {member.app_role?.toUpperCase()}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-2 py-3">
          <div className="min-w-0">
            <p id={`working-${op.id}`} className="text-[13px] font-medium">Working With</p>
            <p className="text-xs text-muted-foreground mt-1">Optional</p>
          </div>
          <div className="w-full min-w-0" role="group" aria-labelledby={`working-${op.id}`}>
            <WorkingWithMultiSelect
              teams={master?.WorkingWithOption || []}
              disabled={!canEdit || saving}
              teamIds={workingTeamIds}
              onTeams={setWorkingTeamIds}
            />
          </div>
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button>}
        {canEdit && <Button type="submit" disabled={!changed || saving || !stageId || !handlerId} className="bg-red-600 text-white hover:bg-red-700 min-w-[126px]">
          {saving ? "Saving…" : "Save Changes"}
        </Button>}
      </div>
    </form>
  );
}

export default function PipelineQuickView({ op, open, onClose, onExpand, initialStageId }) {
  const { maps, profile } = useData();
  const [dirty, setDirty] = useState(false);
  const requestClose = () => {
    if (!dirty || window.confirm("Discard unsaved Pipeline changes?")) onClose();
  };
  const requestExpand = () => {
    if (!dirty || window.confirm("Open Full Detail and discard unsaved changes?")) onExpand();
  };
  if (!op) return null;
  const owner = maps.member?.[op.owner_id];
  const category = maps.category?.[op.product_category_id];
  const canClose = op.status === "open" && (
    profile?.app_role === "admin" || profile?.app_role === "sm" || profile?.app_role === "management" ||
    (profile?.app_role === "ae" && (op.owner_id === profile.id || op.current_handler_id === profile.id))
  );

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) requestClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[710px] max-h-[92vh] overflow-y-auto rounded-2xl p-0 gap-0 [&>button]:hidden">
        <DialogHeader className="border-b px-5 sm:px-7 py-5 text-left relative pr-28">
          <DialogTitle className="text-xl tracking-tight">{op.customer_name}</DialogTitle>
          <DialogDescription className="text-xs mt-1">{textOrDash(category?.name)}{op.product_details ? ` · ${op.product_details}` : ""} · {formatMonth(op.expected_close_month)}</DialogDescription>
          <div className="absolute right-5 top-4 flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9" title="Open Full Detail page" aria-label="Open Full Detail page" onClick={requestExpand}>
              <Maximize2 className="h-4 w-4"/>
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9" title="Close" aria-label="Close" onClick={requestClose}>
              <span className="text-lg leading-none">×</span>
            </Button>
          </div>
        </DialogHeader>
        <div className="px-5 sm:px-7 py-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Net RC / Month</p>
              <p className="text-[22px] font-semibold tabular-nums mt-1">{formatNetRc(op.pipeline_value)}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</p>
              <p className="text-sm font-medium mt-1">{STATUS_LABELS[op.status] || op.status}</p>
            </div>
          </div>
          <PipelineQuickActions op={op} initialStageId={initialStageId} onCancel={requestClose} onDirtyChange={setDirty} onSaved={() => { setDirty(false); onClose(); }}/>
          {canClose && (
            <div className="border-t pt-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Close Pipeline</h3>
              <PipelineCloseActions op={op}
                beforeOpen={() => !dirty || window.confirm("Discard unsaved Stage / Handler / Working With changes?")}
                onClosed={() => { setDirty(false); onClose(); }}/>
            </div>
          )}
          <div className="border-t pt-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Needs Support</p>
              <p className="text-xs text-muted-foreground">{op.support_needed ? "Support requested" : "No support requested"}</p>
            </div>
            <SupportToggleAction op={op} canEdit={canClose} compact
              onSaved={() => { setDirty(false); onClose(); }} />
          </div>
          <div className="border-t pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Pipeline Summary</h3>
              <Button variant="outline" size="sm" type="button" onClick={requestExpand}>View Full Detail</Button>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 mt-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Customer</dt><dd className="font-medium mt-1">{op.customer_name}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Business ID</dt><dd className="font-medium tabular-nums mt-1">{textOrDash(op.business_id)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Sales Channel</dt><dd className="font-medium mt-1">{textOrDash(op.sales_channel)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Contact</dt><dd className="font-medium mt-1">{textOrDash(op.contact_name)}{op.contact_phone ? ` · ${op.contact_phone}` : ""}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Expected Close</dt><dd className="font-medium mt-1">{formatMonth(op.expected_close_month)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">AE Owner</dt><dd className="font-medium mt-1">{textOrDash(owner?.name)}</dd></div>
            </dl>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
