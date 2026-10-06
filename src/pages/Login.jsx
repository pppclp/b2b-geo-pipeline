import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { LogIn, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

const ROLE_ORDER = ["Admin", "Management", "SM", "AE"];

// Dev sign-in: choose a user from the Users sheet. Not real authentication.
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");

  useEffect(() => {
    db.session
      .users()
      .then((list) => (Array.isArray(list) ? setUsers(list) : setError("Unexpected response from the backend — try reloading")))
      .catch((e) => setError(e.message));
  }, []);

  const choose = async (id) => {
    setPending(id);
    await login(id);
    navigate("/", { replace: true });
  };

  return (
    <AuthLayout
      icon={LogIn}
      title="B2B GEO Pipeline"
      subtitle="Local dev — sign in as a user from the Users sheet"
      footer="Roles and permissions come from access_control in b2b_geo_pipeline.yaml"
    >
      {error && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}
      {!users && !error && (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <div className="space-y-5">
        {users &&
          ROLE_ORDER.map((role) => {
            const group = users.filter((u) => u.role === role);
            if (!group.length) return null;
            return (
              <div key={role}>
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">{role}</div>
                <div className="space-y-2">
                  {group.map((u) => (
                    <Button
                      key={u.id}
                      variant="outline"
                      className="w-full h-auto py-2.5 justify-between text-left"
                      disabled={!!pending}
                      onClick={() => choose(u.id)}
                    >
                      <span>
                        <span className="block text-sm font-medium">{u.name}</span>
                        <span className="block text-xs text-muted-foreground">{u.email}</span>
                      </span>
                      {pending === u.id && <Loader2 className="w-4 h-4 animate-spin" />}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
      </div>
    </AuthLayout>
  );
}
