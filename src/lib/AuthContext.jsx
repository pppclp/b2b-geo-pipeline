import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { db, session, onSessionExpired } from '@/api/client';
import { validateApiContract } from '@/lib/apiContract';
const EMAIL_AUTH_ENABLED = import.meta.env.VITE_GEO_EMAIL_AUTH_ENABLED === "true";

// UAT password gate: validate credentials and store a signed short-lived session.
// The backend derives identity from that session, not a browser-supplied user ID.
const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [reauthUser, setReauthUser] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthError, setReauthError] = useState("");
  const [reauthBusy, setReauthBusy] = useState(false);
  const [reauthSetup, setReauthSetup] = useState(null);
  const [reauthStep, setReauthStep] = useState("login");
  const [reauthNewPassword, setReauthNewPassword] = useState("");
  const [reauthConfirmPassword, setReauthConfirmPassword] = useState("");

  useEffect(() => onSessionExpired(() => {
    setSessionExpired(true);
    setReauthPassword("");
    setReauthError("");
    setReauthSetup(null);
    setReauthStep("login");
    setReauthNewPassword("");
    setReauthConfirmPassword("");
  }), []);

  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    setAuthError(null);
    if (!session.token()) {
      setUser(null);
      setIsAuthenticated(false);
    } else {
      try {
        setUser(validateApiContract(await db.session.me()));
        setIsAuthenticated(true);
      } catch (error) {
        session.clear();
        setUser(null);
        setIsAuthenticated(false);
        if (error.status !== 401) setAuthError({ type: error.code === 'API_CONTRACT_MISMATCH' ? 'contract_mismatch' : 'unknown', message: error.message });
      }
    }
    setIsLoadingAuth(false);
    setAuthChecked(true);
  }, []);

  useEffect(() => {
    checkUserAuth();
  }, [checkUserAuth]);

  const login = useCallback(async (username, password, { preserveDraft = false } = {}) => {
    const result = await db.session.login(username, password);
    if (result?.password_setup_required) {
      // A temporary password is verified but never authenticates the user.
      session.clear();
      // Keep the current route and unsaved form mounted inside the expired-session
      // dialog while the user completes first-time password setup.
      if (!preserveDraft) {
        setUser(null);
        setIsAuthenticated(false);
      }
      return result;
    }
    if (!result?.session_token) throw new Error("Login did not return a valid session. Backend deployment may be outdated.");
    session.setToken(result.session_token);
    // Re-auth must not set isLoadingAuth: AuthenticatedApp would unmount
    // the current route and discard an in-progress form.
    let account;
    try {
      account = validateApiContract(await db.session.me());
      if (preserveDraft && user?.id && String(account?.id) !== String(user.id)) {
        throw new Error("Sign in with the same account to return to the unsaved Pipeline form.");
      }
    } catch (error) { session.clear(); throw error; }
    setUser(account);
    setIsAuthenticated(true);
    setAuthError(null);
    setAuthChecked(true);
    setSessionExpired(false);
    setReauthPassword("");
    setReauthError("");
    setReauthStep("login");
    setReauthSetup(null);
    setReauthNewPassword("");
    setReauthConfirmPassword("");
  }, [user?.id]);

  const logout = useCallback(() => {
    session.clear();
    setUser(null);
    setIsAuthenticated(false);
    setSessionExpired(false);
    setReauthSetup(null);
    setReauthStep("login");
  }, []);

  const reauthenticate = async (event) => {
    event.preventDefault();
    if (reauthBusy) return;
    setReauthBusy(true);
    setReauthError("");
    try {
      const outcome = await login(reauthUser.trim(), reauthPassword, { preserveDraft: true });
      if (outcome?.password_setup_required) {
        if (!outcome.password_setup_ticket) throw new Error("Backend did not provide a password setup ticket.");
        setReauthPassword("");
        setReauthSetup({
          ticket: outcome.password_setup_ticket,
          expiresAt: Date.now() + Number(outcome.expires_in_seconds || 600) * 1000,
        });
        setReauthStep("setup");
      }
    } catch (error) {
      setSessionExpired(true);
      setReauthError(error.status === 401
        ? (EMAIL_AUTH_ENABLED ? "Employee ID, email or password is incorrect" : "Employee ID or password is incorrect")
        : error.message || "Unable to sign in again");
    } finally {
      setReauthBusy(false);
    }
  };

  const completeReauthPasswordSetup = async (event) => {
    event.preventDefault();
    if (reauthBusy) return;
    if (!reauthSetup?.ticket || Date.now() >= reauthSetup.expiresAt) {
      setReauthError("Password setup expired. Enter your temporary password again.");
      setReauthStep("login");
      setReauthSetup(null);
      return;
    }
    if (reauthNewPassword.length < 15 || reauthNewPassword.length > 128) {
      setReauthError("Use a unique password of 15–128 characters.");
      return;
    }
    if (reauthNewPassword !== reauthConfirmPassword) {
      setReauthError("Passwords do not match.");
      return;
    }
    setReauthBusy(true);
    setReauthError("");
    try {
      const result = await db.temporaryPassword.complete(
        reauthSetup.ticket, reauthNewPassword, reauthConfirmPassword
      );
      if (result?.password_set !== true) throw new Error("Backend did not confirm password setup.");
      setReauthSetup(null);
      setReauthNewPassword("");
      setReauthConfirmPassword("");
      setReauthPassword("");
      setReauthStep("signin");
    } catch (error) {
      setReauthError(error.status === 401
        ? "Password setup expired or was already used. Sign in with your temporary password again."
        : (error.message || "Unable to save the personal password."));
      if (error.status === 401) {
        setReauthStep("login");
        setReauthSetup(null);
      }
    } finally {
      setReauthBusy(false);
    }
  };

  const navigateToLogin = useCallback(() => {
    window.location.assign(`${import.meta.env.BASE_URL}login`);
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      authChecked,
      sessionExpired,
      login,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState: checkUserAuth,
    }}>
      {children}
      {sessionExpired && isAuthenticated && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          role="presentation">
          <div role="alertdialog" aria-modal="true" aria-labelledby="session-expired-title"
            aria-describedby="session-expired-description"
            className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-xl">
            <h2 id="session-expired-title" className="text-lg font-semibold">Session expired</h2>
            <p id="session-expired-description" className="mt-2 text-sm text-muted-foreground">
              {reauthStep === "setup"
                ? "Your temporary password was verified. Set a personal password to continue without losing your unsaved form."
                : reauthStep === "signin"
                ? "Password saved. Sign in with your new personal password to return to the unsaved form."
                : "Sign in again to continue. Your unsaved Pipeline form is still here. After signing in, review and click Save again."}
            </p>
            {reauthStep === "setup" ? (
              <form onSubmit={completeReauthPasswordSetup} className="mt-4 space-y-3">
                <label htmlFor="reauth-new-password" className="block text-xs font-medium">New Personal Password</label>
                <input id="reauth-new-password" type="password" autoComplete="new-password" required
                  minLength={15} maxLength={128} value={reauthNewPassword}
                  onChange={(e) => setReauthNewPassword(e.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"/>
                <label htmlFor="reauth-confirm-password" className="block text-xs font-medium">Confirm Password</label>
                <input id="reauth-confirm-password" type="password" autoComplete="new-password" required
                  minLength={15} maxLength={128} value={reauthConfirmPassword}
                  onChange={(e) => setReauthConfirmPassword(e.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"/>
                {reauthError && <p role="alert" className="text-xs text-destructive">{reauthError}</p>}
                <button type="submit" disabled={reauthBusy || !reauthNewPassword || !reauthConfirmPassword}
                  className="h-10 w-full rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
                  {reauthBusy ? "Saving…" : "Set Password"}
                </button>
                <button type="button" disabled={reauthBusy}
                  onClick={() => { setReauthStep("login"); setReauthSetup(null); setReauthNewPassword(""); setReauthConfirmPassword(""); setReauthError(""); }}
                  className="w-full text-sm text-muted-foreground underline">Back to sign in</button>
              </form>
            ) : (
              <form onSubmit={reauthenticate} className="mt-4 space-y-3">
                <label htmlFor="reauth-user" className="block text-xs font-medium">{EMAIL_AUTH_ENABLED ? "Employee ID or Corporate Email" : "Employee ID"}</label>
                <input id="reauth-user" autoComplete="username" type="text" autoFocus required
                  value={reauthUser} onChange={(e)=>setReauthUser(e.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"/>
                <label htmlFor="reauth-password" className="block text-xs font-medium">Password</label>
                <input id="reauth-password" type="password" required autoComplete="current-password"
                  value={reauthPassword} onChange={(e)=>setReauthPassword(e.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"/>
                {reauthError && <p role="alert" className="text-xs text-destructive">{reauthError}</p>}
                <button type="submit" disabled={reauthBusy || !reauthUser.trim() || !reauthPassword}
                  className="h-10 w-full rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
                  {reauthBusy ? "Signing in…" : "Sign in and return to form"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
