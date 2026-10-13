import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { db, session } from '@/api/client';

// UAT password gate: validate Employee ID + temporary password once,
// then keep the existing user-id based app session flow.
const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    setAuthError(null);
    if (!session.userId()) {
      setUser(null);
      setIsAuthenticated(false);
    } else {
      try {
        setUser(await db.session.me());
        setIsAuthenticated(true);
      } catch (error) {
        session.clear();
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
    session.setUserId(result.user_id);
    await checkUserAuth();
  }, [checkUserAuth]);

  const logout = useCallback(() => {
    session.clear();
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
