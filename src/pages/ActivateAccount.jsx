import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { db } from "@/api/client";

// UAT rollout is explicitly opt-in. Do not show a dead activation screen to
// existing users until the matching Apps Script deployment and email roster
// have been verified by the UAT operator.
const ENABLED = import.meta.env.VITE_GEO_EMAIL_ACTIVATION_ENABLED === "true";

export default function ActivateAccount() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [expiresAt, setExpiresAt] = useState(0);

  async function verify(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await db.activation.verify(email.trim(), code.trim());
      if (!result.activation_ticket) throw new Error("The backend did not return an activation ticket.");
      setTicket(result.activation_ticket);
      setExpiresAt(Date.now() + Number(result.expires_in_seconds || 600) * 1000);
      setCode("");
    } catch (e) {
      setError(e.status === 401 ? "Activation could not be verified. Check your details or ask your coordinator for a new code." : e.message);
    } finally { setBusy(false); }
  }

  async function finish(event) {
    event.preventDefault();
    if (busy) return;
    if (password.length < 10 || password.length > 128) { setError("Use a unique password between 10 and 128 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (expiresAt && Date.now() >= expiresAt) { setTicket(""); setError("Activation expired. Verify the code again."); return; }
    setBusy(true);
    setError("");
    try {
      const result = await db.activation.complete(ticket, password, confirm);
      if (!result?.activated) throw new Error("Activation was not completed. Please contact your account administrator.");
      setTicket("");
      setPassword("");
      setConfirm("");
      setComplete(true);
    } catch (e) {
      setError(e.status === 401 ? "Activation expired or used. Ask your coordinator for a fresh code." : e.message);
      if (e.status === 401) setTicket("");
    } finally { setBusy(false); }
  }

  return <AuthLayout icon={ShieldCheck} title="B2B GEO Pipeline" subtitle="First-time account activation"
    footer="Only employees with a registered account can activate it.">
    {!ENABLED ? (
      <div role="status" className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground">Activation is not enabled for this deployment.</p>
        <Link className="text-sm text-brand underline" to="/login">Return to Sign in</Link>
      </div>
    ) : complete ? (
      <div role="status" className="space-y-4 text-center">
        <h2 className="text-base font-semibold text-foreground">Your password is set</h2>
        <p className="text-sm text-muted-foreground">Your one-time activation code cannot be used again. Sign in with your corporate email and new password after email login has been enabled.</p>
        <Link className="inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground" to="/login">Return to Sign in</Link>
      </div>
    ) : (
      <form onSubmit={ticket ? finish : verify} className="space-y-4">
        <h2 className="font-semibold text-base">{ticket ? "Set your new password" : "Verify activation code"}</h2>
        {!ticket ? <>
          <div className="space-y-1">
            <label htmlFor="activate-email" className="text-sm font-medium">Corporate Email</label>
            <input id="activate-email" type="email" autoComplete="email" maxLength={254} required
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="name@company-domain" className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" />
          </div>
          <div className="space-y-1">
            <label htmlFor="activate-code" className="text-sm font-medium">One-time Activation Code</label>
            <input id="activate-code" type="text" autoComplete="one-time-code" required
              value={code} onChange={e => setCode(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" />
          </div>
        </> : <>
          <p className="text-xs text-muted-foreground">Choose a unique 10–128 character password. Complete this step within 10 minutes. Do not reuse your corporate SSO password.</p>
          <div className="space-y-1">
            <label htmlFor="activate-password" className="text-sm font-medium">New Password</label>
            <input id="activate-password" type="password" autoComplete="new-password" required minLength={10} maxLength={128}
              value={password} onChange={e => setPassword(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" />
          </div>
          <div className="space-y-1">
            <label htmlFor="activate-confirm" className="text-sm font-medium">Confirm Password</label>
            <input id="activate-confirm" type="password" autoComplete="new-password" required minLength={10} maxLength={128}
              value={confirm} onChange={e => setConfirm(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" />
          </div>
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" type="submit" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {ticket ? "Set Password" : "Verify & Continue"}
        </Button>
        {ticket && <button type="button" className="block w-full text-xs text-muted-foreground underline"
          onClick={() => { setTicket(""); setPassword(""); setConfirm(""); setError(""); }}>
          Start over
        </button>}
        <p className="text-center text-xs"><Link className="text-brand underline" to="/login">Back to Sign in</Link></p>
      </form>
    )}
  </AuthLayout>;
}
