import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { LogIn, Loader2 } from "lucide-react";
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
      setError(e.status === 401 ? "Employee ID or password is incorrect" : e.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout
      icon={LogIn}
      title="B2B GEO Pipeline"
      subtitle="UAT sign in with your Employee ID and temporary password"
      footer="Use the UAT credentials provided to you individually"
    >
      {error && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="employee-id" className="text-sm font-medium">Employee ID</label>
          <input
            id="employee-id"
            name="username"
            inputMode="numeric"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. 90009592"
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
            placeholder="Enter your UAT password"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={pending || !username.trim() || !password}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
