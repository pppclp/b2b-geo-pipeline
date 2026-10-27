import React, { useState, useMemo, useEffect, useRef } from "react";
import { Link, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { useData } from "@/lib/dataContext";
import { ROLE_LABELS } from "@/lib/pipeline";
import { LayoutDashboard, KanbanSquare, Settings, Upload, LogOut, Menu, X, HandHelping, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import DemoAsBar from "@/components/DemoAsBar";
import HandoffBell from "@/components/HandoffBell";
import { actionableErrorMessage } from "@/lib/actionFeedback";

const LOGO_URL = `${import.meta.env.BASE_URL}true-logo.svg?v=20261025`;

const navFor = (role) => {
  const base = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/pipeline", label: "Pipeline", icon: KanbanSquare, view: "all" },
    { to: "/pipeline?view=assigned-to-me", label: "With Me", icon: HandHelping, view: "assigned-to-me" },
  ];
  if (role === "admin") {
    base.push({ to: "/admin", label: "Admin", icon: Settings });
    base.push({ to: "/import", label: "Import", icon: Upload });
  }
  if (role === "sm") {
    base.push({ to: "/import", label: "Import", icon: Upload });
  }
  return base;
};

const sectionTitle = (pathname) => {
  if (pathname === "/") return "Dashboard";
  if (pathname.startsWith("/pipeline")) return "Pipeline";
  if (pathname.startsWith("/opportunity")) return "Pipeline";
  if (pathname.startsWith("/admin")) return "Admin";
  if (pathname.startsWith("/import")) return "Import";
  return "";
};

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("") || "U";
}

export default function AppLayout() {
  const { profile, realProfile, isDemoing, master, error, refresh, loading, lastLoadedAt } = useData();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const mobilePanelRef = useRef(null);
  const mobileCloseRef = useRef(null);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement;
    const panel = mobilePanelRef.current;
    mobileCloseRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) {
        event.preventDefault();
        panel.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onResize = () => { if (window.innerWidth >= 768) setOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  const minutesSinceLoad = lastLoadedAt ? Math.max(0, Math.floor((clock - Date.parse(lastLoadedAt)) / 60000)) : null;
  const freshnessText = error ? "Refresh failed" : loading ? "Loading data…" : !lastLoadedAt ? "Not yet refreshed" : minutesSinceLoad === 0 ? "Updated just now" : `Updated ${minutesSinceLoad} min ago`;

  const items = navFor(profile?.app_role || "ae");
  const displayName = profile?.name || user?.full_name || "User";

  const handleLogout = () => {
    logout(false);
    navigate("/login");
  };

  const Logo = () => (
    <div className="flex items-center gap-2.5">
      <img src={LOGO_URL} alt="true" className="h-6 w-auto object-contain" />
      <div className="leading-tight">
        <div className="font-semibold text-[13px] tracking-tight">B2B GEO Pipeline</div>
      </div>
    </div>
  );

  const currentView = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const view = params.get("view");
    if (view === "assigned-to-me" || params.get("assigned") === "me") return "assigned-to-me";
    if (view === "support-needed" || params.get("support") === "1") return "support-needed";
    return "all";
  }, [location.search]);

  const isItemActive = (item) => {
    if (item.view) {
      return location.pathname === "/pipeline" && currentView === item.view;
    }
    if (item.end) return location.pathname === item.to;
    return location.pathname.startsWith(item.to.split("?")[0]);
  };

  const NavList = () => {
    const sections = [
      { title: "WORKSPACE", links: items.filter((it) =>
        ["/", "/pipeline", "/pipeline?view=assigned-to-me"].includes(it.to)) },
      { title: "TOOLS", links: items.filter((it) =>
        ["/admin", "/import"].includes(it.to)) },
    ].filter((section) => section.links.length > 0);
    return (
      <nav aria-label="Primary navigation" className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.title} className="space-y-1">
            <div className="text-[10px] tracking-wider font-semibold text-muted-foreground/80 px-3 pb-1">
              {section.title}
            </div>
            {section.links.map((it) => {
              const Icon = it.icon;
              const active = isItemActive(it);
              return (
                <Link key={it.to} to={it.to} aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={"group relative flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-medium transition-colors " +
                    (active ? "bg-brand-tint text-brand" : "text-muted-foreground hover:text-foreground hover:bg-secondary/70")}>
                  {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-brand" />}
                  <Icon className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />
                  {it.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    );
  };

  const UserCard = () => (
    <div className="border-t border-sidebar-border p-3 space-y-2">
      <div className="flex items-center gap-2.5 px-1.5">
        <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
          {initials(displayName)}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="text-[13px] font-medium truncate">{displayName}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {ROLE_LABELS[profile?.app_role] || "—"}
            {profile?.isProvisional ? " · Provisional" : ""}
            {isDemoing ? ` · as ${ROLE_LABELS[realProfile?.app_role] || realProfile?.app_role}` : ""}
          </div>
        </div>
      </div>
      {realProfile?.app_role === "admin" && (
        <DemoAsBar variant="trigger" />
      )}
      <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground hover:text-foreground" onClick={handleLogout}>
        <LogOut className="w-4 h-4 mr-2" /> Sign out
      </Button>
    </div>
  );

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      <div className="px-5 h-16 flex items-center border-b border-sidebar-border">
        <Logo />
      </div>
      <NavList />
      <UserCard />
    </div>
  );

  return (
    <div className="h-screen bg-shell flex gap-3 p-3 overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-[232px] shrink-0 rounded-2xl bg-sidebar border border-sidebar-border shadow-card flex-col overflow-hidden">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <button type="button" tabIndex={-1} aria-label="Close navigation" className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside id="mobile-navigation" ref={mobilePanelRef} role="dialog" aria-modal="true" aria-label="Mobile navigation" tabIndex={-1} className="relative w-[232px] bg-sidebar h-full rounded-r-2xl shadow-lift">
            <button ref={mobileCloseRef} type="button" aria-label="Close navigation" className="absolute top-4 right-3 text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>
              <X className="w-5 h-5" />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 gap-3" inert={open ? "" : undefined}>
        {/* Header */}
        <header className="shrink-0 rounded-2xl bg-card border border-border shadow-soft h-16 px-4 md:px-5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" aria-label="Open navigation" aria-expanded={open} aria-controls="mobile-navigation" className="md:hidden text-muted-foreground hover:text-foreground" onClick={() => setOpen(true)}>
              <Menu className="w-5 h-5" />
            </button>
            <div className="md:hidden flex items-center gap-2">
              <img src={LOGO_URL} alt="true" className="h-5 w-auto object-contain" />
            </div>
            <h2 className="hidden md:block text-[15px] font-semibold tracking-tight truncate">
              {sectionTitle(location.pathname)}
            </h2>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
              <span title={lastLoadedAt ? new Date(lastLoadedAt).toLocaleString("en-US") : ""}>{freshnessText}</span>
              <Button variant="ghost" size="sm" disabled={loading} onClick={refresh} aria-label="Refresh Pipeline data" title="Refresh Pipeline data">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <HandoffBell userId={realProfile?.id} />
            <DemoAsBar variant="trigger" />
            <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
              {initials(displayName)}
            </div>
          </div>
        </header>

        <DemoAsBar variant="banner" />

        <main className="flex-1 rounded-2xl bg-card border border-border shadow-soft overflow-auto">
          {master ? (
            <Outlet />
          ) : (
            // First load from Google Sheets can take ~10 s; don't show empty numbers meanwhile.
            <div className="h-full min-h-[320px] flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              {error ? (
                <>
                  <span role="alert" className="text-destructive">{actionableErrorMessage(error, "load")}</span>
                  <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>Retry</Button>
                </>
              ) : (
                <>
                  <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
                  Loading pipeline data…
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}