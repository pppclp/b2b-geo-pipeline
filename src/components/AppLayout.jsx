import React, { useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { useData } from "@/lib/dataContext";
import { ROLE_LABELS } from "@/lib/pipeline";
import { LayoutDashboard, KanbanSquare, AlertCircle, Settings, Upload, LogOut, Menu, X, HandHelping } from "lucide-react";
import { Button } from "@/components/ui/button";
import DemoAsBar from "@/components/DemoAsBar";

const navFor = (role) => {
  const base = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
    { to: "/pipeline?assigned=me", label: "Assigned to Me", icon: HandHelping },
    { to: "/pipeline?support=1", label: "Support Needed", icon: AlertCircle },
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

export default function AppLayout() {
  const { profile, realProfile, isDemoing } = useData();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const items = navFor(profile?.app_role || "ae");

  const handleLogout = () => {
    logout(false);
    navigate("/login");
  };

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 h-16 border-b border-border">
        <div className="w-8 h-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
          G
        </div>
        <div className="leading-tight">
          <div className="font-semibold text-sm">B2B GEO Pipeline</div>
          <div className="text-[11px] text-muted-foreground">Prototype / UAT</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-secondary text-secondary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {it.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <div className="px-2 py-2">
          <div className="text-sm font-medium truncate">{profile?.name || user?.full_name || "User"}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {ROLE_LABELS[profile?.app_role] || "—"}
            {profile?.isProvisional ? " · Provisional" : ""}
            {isDemoing ? ` · (really ${ROLE_LABELS[realProfile?.app_role] || realProfile?.app_role})` : ""}
          </div>
        </div>
        {realProfile?.app_role === "admin" && (
          <div className="px-2 pb-2">
            <DemoAsBar variant="trigger" />
          </div>
        )}
        <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={handleLogout}>
          <LogOut className="w-4 h-4 mr-2" /> Sign out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-border bg-card">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="relative w-64 bg-card h-full">
            <button className="absolute top-4 right-3" onClick={() => setOpen(false)}>
              <X className="w-5 h-5" />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center justify-between h-14 px-4 border-b border-border">
          <button onClick={() => setOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-semibold text-sm">B2B GEO Pipeline</span>
          <div className="flex items-center gap-2">
            <DemoAsBar variant="trigger" />
            <div className="w-1" />
          </div>
        </header>

        <DemoAsBar variant="banner" />

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}