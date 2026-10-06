import React, { useState, useMemo } from "react";
import { Link, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { useData } from "@/lib/dataContext";
import { ROLE_LABELS } from "@/lib/pipeline";
import { LayoutDashboard, KanbanSquare, AlertCircle, Settings, Upload, LogOut, Menu, X, HandHelping } from "lucide-react";
import { Button } from "@/components/ui/button";
import DemoAsBar from "@/components/DemoAsBar";

const LOGO_URL = "https://media.base44.com/images/public/6ac51b65ecc4f77b629b8848/b36c70394_image.png";

const navFor = (role) => {
  const base = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/pipeline", label: "Pipeline", icon: KanbanSquare, view: "all" },
    { to: "/pipeline?view=assigned-to-me", label: "Assigned to Me", icon: HandHelping, view: "assigned-to-me" },
    { to: "/pipeline?view=support-needed", label: "Support Needed", icon: AlertCircle, view: "support-needed" },
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
  if (pathname.startsWith("/opportunity")) return "Opportunity";
  if (pathname.startsWith("/admin")) return "Admin";
  if (pathname.startsWith("/import")) return "Import";
  return "";
};

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("") || "U";
}

export default function AppLayout() {
  const { profile, realProfile, isDemoing } = useData();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

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
        <div className="text-[10px] text-muted-foreground">Prototype / UAT</div>
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

  const NavList = () => (
    <nav className="flex-1 px-3 py-3 space-y-1.5 overflow-y-auto">
      {items.map((it) => {
        const Icon = it.icon;
        const active = isItemActive(it);
        return (
          <Link
            key={it.to}
            to={it.to}
            onClick={() => setOpen(false)}
            className={`group relative flex items-center gap-2.5 md:gap-3 px-4 md:px-5 py-3 md:py-3.5 rounded-2xl text-[15px] md:text-[16px] font-semibold transition-all ${
              active
                ? "bg-brand-tint text-brand"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/70"
            }`}
          >
            {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-brand" />}
            <Icon className="w-[18px] h-[18px] md:w-5 md:h-5 shrink-0" />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );

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
      <aside className="hidden md:flex w-64 shrink-0 rounded-2xl bg-sidebar border border-sidebar-border shadow-card flex-col overflow-hidden">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="relative w-64 bg-sidebar h-full rounded-r-2xl shadow-lift">
            <button className="absolute top-4 right-3 text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>
              <X className="w-5 h-5" />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 gap-3">
        {/* Header */}
        <header className="shrink-0 rounded-2xl bg-card border border-border shadow-soft h-16 px-4 md:px-5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button className="md:hidden text-muted-foreground hover:text-foreground" onClick={() => setOpen(true)}>
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
            <DemoAsBar variant="trigger" />
            <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
              {initials(displayName)}
            </div>
          </div>
        </header>

        <DemoAsBar variant="banner" />

        <main className="flex-1 rounded-2xl bg-card border border-border shadow-soft overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}