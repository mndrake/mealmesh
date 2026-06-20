// GET /api/kroger/callback — Kroger redirects the browser here after the user grants
// access. No auth header (it's a top-level redirect), so the household is recovered from
// the one-time CSRF `state`. Exchanges code -> tokens and stores them, then bounces back
// to the app. Tokens never touch the browser.
import { consumeState, saveTokens } from "./_shared/supa";
import { apiBase, basicAuthHeader, authCodeTokenBody, computeExpiresAt } from "./_shared/kroger";
import { redirect } from "./_shared/http";

export default async (req: Request): Promise<Response> => {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  if (!code || !state) return redirect("/?kroger=error");

  const ctx = await consumeState(state);
  if (!ctx) return redirect("/?kroger=error"); // unknown/expired state → reject (CSRF)

  const res = await fetch(`${apiBase(process.env)}/v1/connect/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(process.env.KROGER_CLIENT_ID!, process.env.KROGER_CLIENT_SECRET!),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: authCodeTokenBody(code, process.env.KROGER_REDIRECT_URI!),
  });
  if (!res.ok) {
    console.warn("[kroger] token exchange failed:", res.status);
    return redirect("/?kroger=error");
  }

  const tok = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  await saveTokens(
    ctx.householdId,
    {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: new Date(computeExpiresAt(Date.now(), tok.expires_in)).toISOString(),
    },
    ctx.createdBy
  );
  return redirect("/?kroger=connected");
};
