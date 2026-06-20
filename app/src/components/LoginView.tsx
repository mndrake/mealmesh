// Magic-link login screen (M1). Invite-only: only allowlisted family emails can complete
// sign-in (enforced by Supabase Auth settings + the allowlist trigger — see docs/security.md).
import { useState } from "react";
import { useAuth } from "../lib/auth";

export function LoginView() {
  const { status, signInWithEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unconfigured = status === "unconfigured";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    const err = await signInWithEmail(email);
    setBusy(false);
    if (err) setError(err);
    else setSent(true);
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand" style={{ fontSize: "1.4rem", marginBottom: 4 }}>
          <span className="logo">◍</span> MealMesh
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Shared family meal planning. Sign in with your email.
        </p>

        {unconfigured ? (
          <p className="login-note">
            Sign-in isn’t configured yet. Set <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> (see <code>app/.env.example</code>).
          </p>
        ) : sent ? (
          <p className="login-note">
            Check <strong>{email}</strong> for a sign-in link. You can close this tab; the
            link opens MealMesh signed in.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="col" style={{ gap: 10 }}>
            <input
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email address"
            />
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send magic link"}
            </button>
            {error && <p className="login-error">{error}</p>}
          </form>
        )}

        <p className="muted" style={{ fontSize: "0.75rem", marginBottom: 0 }}>
          Invite-only — only family members added by the household owner can sign in.
        </p>
      </div>
    </div>
  );
}
