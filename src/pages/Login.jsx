import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { LogIn, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

const EMAIL_AUTH_ENABLED = import.meta.env.VITE_GEO_EMAIL_AUTH_ENABLED === "true";
const ACTIVATION_UI_ENABLED = import.meta.env.VITE_GEO_EMAIL_ACTIVATION_ENABLED === "true";
import AuthLayout from "@/components/AuthLayout";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      await login(username.trim(), password);
      navigate("/", { replace: true });
    } catch (e) {
      setError(e.status === 401 ? EMAIL_AUTH_ENABLED ? "Email or password is incorrect" : "Employee ID or password is incorrect" : e.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout
      icon={LogIn}
      title="B2B GEO Pipeline"
      subtitle={EMAIL_AUTH_ENABLED ? "Sign in with your approved corporate email and password" : "UAT sign in with your Employee ID and temporary password"}
      footer={EMAIL_AUTH_ENABLED ? "For account activation, use the code delivered by your authorized UAT coordinator" : "Use the UAT credentials provided to you individually"}
    >
      {error && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="employee-id" className="text-sm font-medium">{EMAIL_AUTH_ENABLED ? "Corporate Email" : "Employee ID"}</label>
          <input
            id="employee-id"
            name="username"
            inputMode={EMAIL_AUTH_ENABLED ? "email" : "numeric"}
            type={EMAIL_AUTH_ENABLED ? "email" : "text"}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={EMAIL_AUTH_ENABLED ? "name@company-domain" : "e.g. 90009592"}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={EMAIL_AUTH_ENABLED ? "Enter your password" : "Enter your UAT password"}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={pending || !username.trim() || !password}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
          Sign in
        </Button>
      </form>
      {ACTIVATION_UI_ENABLED && <p className="mt-5 text-center text-sm"><Link className="text-brand underline-offset-4 hover:underline" to="/activate">First-time activation</Link></p>}
    </AuthLayout>
  );
}
