import React, { useState } from "react";
import { Trophy, XCircle } from "lucide-react";
import { useData } from "@/lib/dataContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { actionableErrorMessage } from "@/lib/actionFeedback";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * Shared close-out controls for Quick View and the Full Detail page.
 * Closing a Pipeline changes Status (not Stage) and leaves Stage/Handler
 * aging intact. Lost Reason is required, note is optional.
 */
export default function PipelineCloseActions({ op, onClosed, beforeOpen, compact = false }) {
  const { master, profile, markWon, markLost } = useData();
  const [choice, setChoice] = useState(null);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const allowed = op.status === "open" && (
    profile?.app_role === "admin" ||
    profile?.app_role === "sm" || profile?.app_role === "management" ||
    (profile?.app_role === "ae" && (op.owner_id === profile.id || op.current_handler_id === profile.id))
  );
  const lostReasons = (master?.LostReason || []).filter((reason) => reason.active)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (!allowed) return null;

  const openAction = (status) => {
    if (saving || (beforeOpen && !beforeOpen())) return;
    setChoice(status);
    setReasonId("");
    setNote("");
    setError("");
  };
  const closeDialog = () => {
    if (saving) return;
    setChoice(null);
    setError("");
  };
  const submit = async () => {
    if (saving) return;
    if (choice === "lost" && !lostReasons.some((r) => r.id === reasonId)) {
      setError("Select a Lost Reason");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (choice === "won") await markWon(op.id);
      else if (choice === "lost") await markLost(op.id, { reason_id: reasonId, note: note.trim() });
      else return;
      setChoice(null);
      onClosed?.();
    } catch (err) {
      setError(actionableErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className={compact ? "flex items-center gap-2" : "flex flex-wrap items-center gap-2"}>
        <Button type="button" variant="outline" size="sm" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          onClick={() => openAction("won")}>
          <Trophy className="h-4 w-4 mr-1.5" /> Won
        </Button>
        <Button type="button" variant="outline" size="sm" className="border-rose-200 text-rose-700 hover:bg-rose-50"
          onClick={() => openAction("lost")}>
          <XCircle className="h-4 w-4 mr-1.5" /> Lost
        </Button>
      </div>
      <Dialog open={!!choice} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{choice === "won" ? "Confirm Won" : "Confirm Lost"}</DialogTitle>
            <DialogDescription>
              {choice === "won"
                ? "Confirm that this Pipeline has been won."
                : "Select the reason this Pipeline was lost."}
            </DialogDescription>
          </DialogHeader>
          {choice === "lost" && (
            <div className="space-y-3 py-1">
              <div className="space-y-2">
                <Label htmlFor="pipeline-lost-reason">Lost Reason <span className="text-red-600">*</span></Label>
                <Select value={reasonId} onValueChange={setReasonId}>
                  <SelectTrigger id="pipeline-lost-reason"><SelectValue placeholder="Select Lost Reason" /></SelectTrigger>
                  <SelectContent>
                    {lostReasons.map((reason) =>
                      <SelectItem key={reason.id} value={reason.id}>{reason.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {!lostReasons.length && <p className="text-xs text-rose-600">No active Lost Reasons. Contact Admin.</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="pipeline-lost-note">Lost Note (Optional)</Label>
                <Textarea id="pipeline-lost-note" value={note} onChange={(e) => setNote(e.target.value)}
                  rows={3} placeholder="Additional details" />
              </div>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={closeDialog}>Cancel</Button>
            <Button type="button" disabled={saving || (choice === "lost" && !lostReasons.some((r) => r.id === reasonId))}
              onClick={submit} className={choice === "lost" ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-emerald-700 text-white hover:bg-emerald-800"}>
              {saving ? "Saving…" : choice === "lost" ? "Confirm Lost" : "Confirm Won"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
