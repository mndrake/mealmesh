# Setup: Supabase + Netlify (single family)

One-time provisioning to take MealMesh from localStorage-only to cloud-synced and
deployed. Order matters: **Supabase first**, then **Netlify**, then wire the Netlify
URL back into Supabase Auth. See [`security.md`](./security.md) and
[`data-model.md`](./data-model.md) for the why.

## 1. Create the Supabase project
1. https://supabase.com → New project (free tier is fine for one family). Pick a region
   near you and save the database password.
2. **SQL Editor** → run, in order:
   - the contents of `supabase/migrations/0001_init.sql`
   - the contents of `supabase/migrations/0002_state.sql`
   - `supabase/seed.sql` — **edit the emails to your real family emails first**.
3. **Authentication → Providers → Email:** enable it; ensure **magic link** works
   (Confirm email on). **Disable "Allow new users to sign up"** (invite-only).
4. **Authentication → URL Configuration:**
   - Site URL: `http://localhost:5173` (for local dev now; change to the Netlify URL later).
   - Redirect URLs: add `http://localhost:5173/**` (add the Netlify URL in step 4).
5. **Project Settings → API:** copy the **Project URL** and the **anon / publishable**
   key. (The `service_role` key stays in the dashboard — never put it in the app, repo,
   or Netlify.)

## 2. Wire it locally and verify
Create `app/.env.local` (git-ignored):
```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```
Then:
```
cd app && npm run dev
```
- Sign in with an allowlisted email → magic link → you land in the app.
- Edit a plan / favorite a recipe → reload → state restored from the cloud.
- Open in a second browser/device signed in as a family member → changes appear
  without refresh (Realtime).
- RLS check: a non-allowlisted email cannot get a working session.

## 3. Deploy to Netlify
1. https://app.netlify.com → Add new site → Import from GitHub → `mndrake/mealmesh`.
   Netlify reads `netlify.toml` (base `app/`, build `npm run build`, publish `app/dist`).
2. **Site settings → Environment variables:** add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (same values as `.env.local`). Do **not** add `service_role`.
3. Deploy. Note the site URL (e.g. `https://mealmesh-xyz.netlify.app`).

## 4. Point Supabase Auth at the Netlify domain
Back in Supabase → Authentication → URL Configuration:
- Set **Site URL** to the Netlify URL.
- Add `https://<your-site>.netlify.app/**` to **Redirect URLs** (keep localhost too for dev).

Now magic-link sign-in works from any device, and the family can use it from their phones.

## Notes
- The anon key is public by design; security rests on RLS, not key secrecy.
- Recipes stay bundled (read-only); only plans/favorites/check-offs (and later cook log)
  live in Supabase.
- Full security-header/CSP hardening is tracked in M4; `netlify.toml` already ships sane
  defaults (HSTS, CSP scoped to `*.supabase.co`, SPA redirect).
