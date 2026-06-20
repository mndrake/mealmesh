# Security model

Goal: **enough security for a shared single-family app** — not enterprise-grade, but no
open doors. The app holds meal plans and recipe notes (low sensitivity), but access must be
limited to invited family members and data must not leak between the public internet and the
household.

## Principles
- **Invite-only.** No one can self-register. Only allowlisted family emails get in.
- **RLS is the boundary.** All data access is authorized in Postgres via Row-Level Security,
  not in the client. A leaked anon key cannot read another household's data.
- **No privileged secrets in the browser.** The frontend only ever holds the Supabase URL
  and the **publishable anon key** (public by design). The `service_role` key is never
  shipped, logged, or committed.

## Authentication — magic link, invite-only
- **Login:** `supabase.auth.signInWithOtp({ email })` emails a one-time magic link; clicking
  it establishes a session (JWT). No passwords to manage.
- **Restrict who can sign in (two layers):**
  1. **Disable public sign-ups** in Supabase Auth settings; add family members via the
     dashboard **Invite** action (also delivers a magic link).
  2. **Allowlist enforcement** as defense-in-depth: a "before user created" auth hook (or a
     trigger on `auth.users`) checks the email against the `allowed_emails` table and rejects
     anything not present; on success it inserts the `household_members` row linking the new
     user to the household.
- **Redirect URLs:** lock Supabase Auth "Site URL" + "Redirect URLs" to the Netlify domain(s)
  only (production + any preview domain you actually use), so magic links can't be redirected
  elsewhere.
- **Session handling:** supabase-js persists/refreshes the session; the app shell renders only
  when a session exists, otherwise shows the login screen. Provide explicit sign-out.

## Authorization — Row-Level Security
- RLS enabled on every table; policies scope rows to `is_member(household_id)`
  (see [`data-model.md`](./data-model.md)). Default-deny: no policy = no access.
- The `is_member` helper is `security definer` with a fixed `search_path` to prevent
  privilege/search-path attacks.
- Realtime respects RLS, so devices only receive change events for their own household.

## Secrets & environment variables
| Name | Where | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Netlify build env + `app/.env.local` | Public. |
| `VITE_SUPABASE_ANON_KEY` | Netlify build env + `app/.env.local` | Public by design; safe with RLS. |
| `service_role` key | Supabase dashboard only | **Never** in repo, frontend, or Netlify build. |

- `app/.env.local` is git-ignored (extend `.gitignore` to cover `.env*` in M1).
- Vite exposes only `VITE_`-prefixed vars to the client — keep it that way; never prefix a
  secret with `VITE_`.

## Netlify hosting hardening
Add a `netlify.toml` (M4) with:
- **SPA redirect:** `/* -> /index.html (200)` so client routing works.
- **Security headers** via `[[headers]]` (or a `_headers` file):
  - `Content-Security-Policy` allowing `self` + the Supabase project origin
    (`connect-src` for REST + `wss:` for Realtime) and the bundled image paths.
  - `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
    `Referrer-Policy: strict-origin-when-cross-origin`,
    `Permissions-Policy` disabling unused features,
    `Strict-Transport-Security` (HSTS).
- **HTTPS only** (Netlify default) + force-TLS.
- Optional extra gate: Netlify "Visitor access" password on the site — usually unnecessary
  since Supabase auth already gates the entire app; skip unless you want belt-and-suspenders.

## Threats considered (and the mitigation)
- *Stranger finds the URL* → sees only the login screen; cannot sign up (invite-only); cannot
  request a working magic link without an allowlisted email.
- *Anon key is public* → expected; RLS prevents reading/writing any household's data without a
  valid member session.
- *XSS exfiltrating the session* → mitigated by CSP, React's default escaping, and avoiding
  `dangerouslySetInnerHTML` on untrusted input. (Recipe method markdown is from the read-only
  bundled dataset, not user input.)
- *Cross-household leakage* → impossible under default-deny RLS scoped by `household_id`.

## Pre-launch security checklist (M4)
- [ ] Public sign-ups disabled; allowlist hook/trigger verified to reject non-family emails.
- [ ] RLS enabled + a policy on every table; verified an unrelated user gets zero rows.
- [ ] Only `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in the frontend bundle (grep the build).
- [ ] `service_role` key absent from repo, env, and logs.
- [ ] Auth redirect URLs restricted to the Netlify domain(s).
- [ ] Security headers + HSTS + SPA redirect present in `netlify.toml`.
- [ ] `.env*` git-ignored; no secrets in git history.
