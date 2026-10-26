import React, { useState } from "react";
import { useData } from "@/lib/dataContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { actionableErrorMessage } from "@/lib/actionFeedback";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LifeBuoy } from "lucide-react";

// One contextual request action shared by Full Detail and Quick View.
// No ticket is created; this changes the role-scoped Pipeline flag.
export default function SupportToggleAction({ op, canEdit, onSaved, compact = false, disabled = false }) {
  const { master, setSupport } = useData();
  const [open, setOpen] = useState(false);
  const [supportType, setSupportType] = useState("");
  const [supportNote, setSupportNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingRevision, setEditingRevision] = useState("");
  const [conflicted, setConflicted] = useState(false);
  const needed = !!op.support_needed;
  const types = (master?.SupportType || []).filter((type) => type.active);

  const close = () => { if (!saving) { setOpen(false); setError(""); } };
  const openDialog = () => { setSupportType(""); setSupportNote(""); setError(""); setConflicted(false); setEditingRevision(op.updated_date || ""); setOpen(true); };
  const save = async () => {
    if (saving || conflicted || disabled || !canEdit || (!needed && (!supportType || !supportNote.trim()))) return;
    setSaving(true);
    setError("");
    try {
      await setSupport(op.id, { needed: !needed, type: supportType, note: supportNote.trim(), expectedUpdatedAt: editingRevision });
      setOpen(false);
      onSaved?.();
    } catch (err) {
      if (err?.status === 409) setConflicted(true);
      setError(actionableErrorMessage(err));
    } finally { setSaving(false); }
  };

  return <>
    {canEdit && <Button type="button" size="sm" variant="outline" onClick={openDialog}
      disabled={disabled || saving} title={disabled ? "Save or discard unsaved Quick Update changes first" : undefined}
      className={compact ? "h-8 text-xs" : "h-9 rounded-lg"}>
      <LifeBuoy className="mr-2 h-4 w-4" />
      {needed ? "Remove Needs Support" : "Request Support"}
    </Button>}
    <Dialog open={open} onOpenChange={(value) => { if (!value) close(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{needed ? "Remove Needs Support?" : "Request Support"}</DialogTitle>
          <DialogDescription>
            {needed
              ? "This Pipeline will no longer appear in Needs Support. The current support type and note will be cleared; the change remains in History."
              : "Flag this Pipeline for assistance. Select the issue and briefly explain what is needed."}
          </DialogDescription>
        </DialogHeader>
        {!needed && <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor={`support-type-${op.id}`}>Support Type *</Label>
            <Select value={supportType} onValueChange={setSupportType}>
              <SelectTrigger id={`support-type-${op.id}`}><SelectValue placeholder="Select support type" /></SelectTrigger>
              <SelectContent>{types.map((type) =>
                <SelectItem key={type.id} value={type.name}>{type.name}</SelectItem>
              )}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`support-note-${op.id}`}>Support Note *</Label>
            <Textarea id={`support-note-${op.id}`} rows={3} maxLength={1000}
              placeholder="Describe the support needed" value={supportNote}
              onChange={(event) => setSupportNote(event.target.value)} />
          </div>
        </div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {conflicted && <p className="text-xs text-muted-foreground">This form is locked to protect the latest update. Copy your notes, close it and refresh the Pipeline before editing again.</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={save} disabled={saving || conflicted || !canEdit || (!needed && (!supportType || !supportNote.trim()))}>
            {saving ? "Saving…" : needed ? "Remove Support" : "Request Support"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
