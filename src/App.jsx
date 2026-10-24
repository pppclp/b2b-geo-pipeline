import { lazy, Suspense } from "react";
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

const RouteLoading = () => (
  <div role="status" className="flex min-h-[220px] items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" aria-label="Loading page" />
  </div>
);

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
          <Route path="/" element={<Suspense fallback={<RouteLoading />}><Dashboard /></Suspense>} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/support-requests" element={<SupportRequests />} />
          <Route path="/opportunity/:id" element={<Suspense fallback={<RouteLoading />}><OpportunityDetail /></Suspense>} />
          <Route path="/admin" element={<Suspense fallback={<RouteLoading />}><Admin /></Suspense>} />
          <Route path="/import" element={<Suspense fallback={<RouteLoading />}><Import /></Suspense>} />
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
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App