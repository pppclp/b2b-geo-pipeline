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

  useEffect(() => onSessionExpired(() => {
    setSessionExpired(true);
    setReauthPassword("");
    setReauthError("");
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

  const login = useCallback(async (username, password) => {
    const result = await db.session.login(username, password);
    if (result?.password_setup_required) {
      // A temporary password is verified but never authenticates the user.
      session.clear();
      setUser(null);
      setIsAuthenticated(false);
      return result;
    }
    if (!result?.session_token) throw new Error("Login did not return a valid session. Backend deployment may be outdated.");
    session.setToken(result.session_token);
    // Re-auth must not set isLoadingAuth: AuthenticatedApp would unmount
    // the current route and discard an in-progress form.
    let account;
    try { account = validateApiContract(await db.session.me()); }
    catch (error) { session.clear(); throw error; }
    setUser(account);
    setIsAuthenticated(true);
    setAuthError(null);
    setAuthChecked(true);
    setSessionExpired(false);
    setReauthPassword("");
    setReauthError("");
  }, []);

  const logout = useCallback(() => {
    session.clear();
    setUser(null);
    setIsAuthenticated(false);
    setSessionExpired(false);
  }, []);

  const reauthenticate = async (event) => {
    event.preventDefault();
    if (reauthBusy) return;
    setReauthBusy(true);
    setReauthError("");
    try {
      const outcome = await login(reauthUser.trim(), reauthPassword);
      if (outcome?.password_setup_required) {
        setReauthError("Temporary credentials require password setup. Return to Sign in and complete setup.");
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
              Sign in again to continue. Your unsaved Pipeline form is still here.
              After signing in, review and click Save again.
            </p>
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
