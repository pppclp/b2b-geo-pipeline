import React, { useState, useMemo } from "react";
import { useData } from "@/lib/dataContext";
import { ROLE_LABELS } from "@/lib/pipeline";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, X } from "lucide-react";

// Admin-only "Demo As" control. Simulates another role/user's permission scope
// without changing the real admin account. variant: "trigger" (button) or "banner".
export default function DemoAsBar({ variant = "trigger" }) {
  const { realProfile, profile, isDemoing, demoAs, exitDemo, master } = useData();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("ae");
  const [memberId, setMemberId] = useState("");

  const isAdmin = realProfile?.app_role === "admin";
  const members = useMemo(() => (master?.TeamMember || []).filter((m) => m.active && m.app_role === role), [master, role]);
  const roleMembers = useMemo(() => members, [members, role]);

  if (!isAdmin) return null;

  if (isDemoing) {
    if (variant === "trigger") return null;
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-amber-100 text-amber-900 text-xs">
        <span className="flex items-center gap-1.5 font-medium truncate">
          <Eye className="w-3.5 h-3.5 shrink-0" />
          Viewing as {ROLE_LABELS[profile?.app_role] || profile?.app_role} — {profile?.name}
        </span>
        <Button size="sm" variant="outline" className="h-7 text-xs border-amber-400 bg-white hover:bg-amber-50" onClick={exitDemo}>
          <X className="w-3.5 h-3.5 mr-1" /> Exit Demo
        </Button>
      </div>
    );
  }

  const start = () => {
    if (memberId) { demoAs(memberId); setOpen(false); setMemberId(""); }
  };

  if (variant === "banner") return null;

  return (
    <>
      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setOpen(true)}>
        <Eye className="w-3.5 h-3.5 mr-1" /> Demo As
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Demo As — UAT Simulation</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Simulate another role/user's permission scope. Your admin account stays unchanged.</p>
          <div className="space-y-3 py-2">
            <div>
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => { setRole(v); setMemberId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ae">AE</SelectItem>
                  <SelectItem value="sm">SM</SelectItem>
                  <SelectItem value="management">Management</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Specific User</Label>
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent>
                  {roleMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}{m.title ? ` — ${m.title}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {roleMembers.length === 0 && <p className="text-xs text-muted-foreground mt-1">No active {ROLE_LABELS[role]} members. Add one in Admin → Team Members.</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={start} disabled={!memberId}>Start Demo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}