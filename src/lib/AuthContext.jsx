import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { db, session } from '@/api/client';

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

  useEffect(() => {
    const onExpired = () => setSessionExpired(true);
    window.addEventListener("geo:session-expired", onExpired);
    return () => window.removeEventListener("geo:session-expired", onExpired);
  }, []);

  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    setAuthError(null);
    if (!session.token()) {
      setUser(null);
      setIsAuthenticated(false);
    } else {
      try {
        setUser(await db.session.me());
        setIsAuthenticated(true);
      } catch (error) {
        session.clear();
        setSessionExpired(false);
        setUser(null);
        setIsAuthenticated(false);
        if (error.status !== 401) setAuthError({ type: 'unknown', message: error.message });
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
    if (!result?.session_token) throw new Error("Login did not return a valid session. Backend deployment may be outdated.");
    session.setToken(result.session_token);
    if (sessionExpired) {
      // Do not toggle isLoadingAuth: doing so unmounts the active Pipeline form.
      const refreshedUser = await db.session.me();
      setUser(refreshedUser);
      setIsAuthenticated(true);
      setAuthError(null);
      setSessionExpired(false);
      return;
    }
    await checkUserAuth();
  }, [checkUserAuth, sessionExpired]);

  const logout = useCallback(() => {
    session.clear();
    setSessionExpired(false);
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  const navigateToLogin = useCallback(() => {
    window.location.assign(`${import.meta.env.BASE_URL}login`);
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      sessionExpired,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      authChecked,
      login,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState: checkUserAuth,
    }}>
      {children}
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
