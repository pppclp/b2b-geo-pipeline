import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import { DataProvider } from '@/lib/dataContext';
import AppLayout from '@/components/AppLayout';
const Dashboard = lazy(() => import('@/pages/Dashboard'));
import Pipeline from '@/pages/Pipeline';
import SupportRequests from '@/pages/SupportRequests';
const OpportunityDetail = lazy(() => import('@/pages/OpportunityDetail'));
const Admin = lazy(() => import('@/pages/Admin'));
const Import = lazy(() => import('@/pages/Import'));
import Login from '@/pages/Login';
import { Navigate } from 'react-router-dom';
import { lazy, Suspense, useState } from 'react';

const LazyPageFallback = () => (
  <div className="flex min-h-[240px] items-center justify-center" role="status" aria-label="Loading page">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
  </div>
);

function SessionExpiredModal() {
  const { sessionExpired, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!sessionExpired) return null;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username.trim(), password);
      setPassword("");
    } catch (cause) {
      setError(cause.status === 401 ? "Employee ID or password is incorrect" : cause.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="session-expired-title"
        className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl">
        <h2 id="session-expired-title" className="text-lg font-semibold">Session expired</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in again to continue. Your unfinished Pipeline edits will be kept.
          After signing in, review the form and click Save again.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block text-xs font-medium" htmlFor="renew-employee">Employee ID</label>
          <input id="renew-employee" autoComplete="username" required value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" />
          <label className="block text-xs font-medium" htmlFor="renew-password">Password</label>
          <input id="renew-password" type="password" autoComplete="current-password" required
            value={password} onChange={(event) => setPassword(event.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={busy || !username.trim() || !password}
            className="h-10 w-full rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            {busy ? "Signing in…" : "Sign in and continue"}
          </button>
        </form>
      </div>
    </div>
  );
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<DataProvider><AppLayout /></DataProvider>}>
          <Route path="/" element={<Suspense fallback={<LazyPageFallback />}><Dashboard /></Suspense>} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/support-requests" element={<SupportRequests />} />
          <Route path="/opportunity/:id" element={<Suspense fallback={<LazyPageFallback />}><OpportunityDetail /></Suspense>} />
          <Route path="/admin" element={<Suspense fallback={<LazyPageFallback />}><Admin /></Suspense>} />
          <Route path="/import" element={<Suspense fallback={<LazyPageFallback />}><Import /></Suspense>} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <ScrollToTop />
          <AuthenticatedApp />
          <SessionExpiredModal />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App