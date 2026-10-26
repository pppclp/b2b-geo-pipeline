import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ShieldCheck, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { db } from "@/api/client";

// The signed ticket is passed through router state only, never a URL or storage.
// Refreshing the page requires signing in with the temporary password again.
export default function SetTemporaryPassword() {
  const location = useLocation();
  const ticket = location.state?.passwordSetupTicket || "";
  const expiresAt = location.state?.expiresAt || 0;
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (newPassword.length < 15 || newPassword.length > 128) {
      setError("Use a unique password of 15–128 characters."); return;
    }
    if (newPassword !== confirm) {
      setError("Passwords do not match."); return;
    }
    if (!ticket || Date.now() >= expiresAt) {
      setError("Your verification expired. Sign in with your temporary password again."); return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await db.temporaryPassword.complete(ticket, newPassword, confirm);
      if (result?.password_set !== true) throw new Error("The backend did not confirm your password was saved.");
      setNewPassword("");
      setConfirm("");
      setComplete(true);
    } catch (e) {
      setError(e.status === 401 ? "Setup expired or already used. Sign in with your temporary password again." :
        e.message || "Unable to save password.");
    } finally { setBusy(false); }
  }

  return (
    <AuthLayout icon={ShieldCheck} title="B2B GEO Pipeline"
      subtitle="Set your personal password"
      footer="UAT only. Do not reuse your corporate SSO password.">
      {complete ? (
        <div role="status" className="space-y-4 text-center">
          <h2 className="text-base font-semibold">Your password has been saved</h2>
          <p className="text-sm text-muted-foreground">Your temporary password can no longer be used. Sign in with your new password.</p>
          <Link to="/login" className="inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Return to Sign in</Link>
        </div>
      ) : !ticket ? (
        <div role="status" className="space-y-3 text-center">
          <p className="text-sm text-muted-foreground">To set your password, sign in using your Employee ID and temporary password first.</p>
          <Link to="/login" className="text-sm text-brand underline">Back to Sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted-foreground">Your temporary password was verified. Create a unique password of 15–128 characters. This step expires after 10 minutes.</p>
          <div className="space-y-1">
            <label htmlFor="setup-new-password" className="text-sm font-medium">New Password</label>
            <input id="setup-new-password" type="password" autoComplete="new-password" required minLength={15} maxLength={128}
              value={newPassword} onChange={e => setNewPassword(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" />
          </div>
          <div className="space-y-1">
            <label htmlFor="setup-confirm-password" className="text-sm font-medium">Confirm Password</label>
            <input id="setup-confirm-password" type="password" autoComplete="new-password" required minLength={15} maxLength={128}
              value={confirm} onChange={e => setConfirm(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" type="submit" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Set Password
          </Button>
          <p className="text-center text-sm"><Link to="/login" className="text-brand underline">Back to Sign in</Link></p>
        </form>
      )}
    </AuthLayout>
  );
}
