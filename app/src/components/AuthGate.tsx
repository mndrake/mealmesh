// Decides what to render based on auth status (M1). Kept separate from <App/> so the
// app shell can still be unit-tested in isolation.
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { LoginView } from "./LoginView";

export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div className="login-wrap">
        <div className="muted">Loading…</div>
      </div>
    );
  }

  if (status === "signed_in") return <>{children}</>;

  // signed_out or unconfigured
  return <LoginView />;
}
