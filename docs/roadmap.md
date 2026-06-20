# Roadmap & milestones

Each milestone ships independently and leaves `main` deployable. Effort is rough
(S ≈ <½ day, M ≈ 1–2 days, L ≈ 3–5 days) for one engineer.

---

## M0 — Foundation & provisioning (S)
**Goal:** Accounts, projects, and docs in place; nothing user-visible changes yet.

**Scope / tasks**
- Provision a **Supabase** project (prod) and a separate dev project.
- Create a **Netlify** site from the repo; build command `npm run build` (base dir `app/`),
  publish `app/dist`. Confirm the current static app deploys unchanged.
- Set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in Netlify + `app/.env.local`.
- Land this `docs/` set and the `.claude/` assets.

**Acceptance**
- The existing app is live on a Netlify URL (still localStorage-only).
- Both Supabase projects exist; env vars resolve in a local build.
- `npm run test` and `npm run lint` pass in CI/locally.

---

## M1 — Auth & access control (M)
**Goal:** Invite-only magic-link login gates the app; household model exists.

**Scope / tasks**
- Add `supabase-js`; create `app/src/lib/supabase.ts` (client from env).
- `supabase/migrations/0001_init.sql`: `households`, `household_members`, `allowed_emails`,
  RLS + `is_member()` helper (per [`data-model.md`](./data-model.md)).
- Disable public sign-ups; add allowlist auth-hook/trigger; seed one household + family emails.
- Build `AuthProvider`, a **login screen** (email → magic link), session handling, sign-out.
- Gate the app shell in `App.tsx`: render the app only with a session; else the login screen.
- Restrict Auth redirect URLs to the Netlify domain(s); extend `.gitignore` for `.env*`.

**Acceptance**
- A non-allowlisted email cannot get a working session; an allowlisted family member logs in
  via magic link on any device and lands in the app.
- Reload preserves the session; sign-out returns to login.
- RLS verified: a user with no membership reads zero rows.

**Touches:** `app/src/App.tsx`, new `app/src/lib/supabase.ts`, new auth components,
`supabase/migrations/`.

---

## M2 — Cloud state & multi-device sync (L)
**Goal:** Plans, favorites, and shopping check-offs live in Supabase and sync across devices.
**This delivers requirement 2.**

**Scope / tasks**
- Migration `0002_state.sql`: `plans`, `favorites`, `shopping_checkoffs` (+ RLS, Realtime).
- Reimplement [`app/src/lib/store.ts`](../app/src/lib/store.ts) internals while **preserving
  `useStore` + `actions`** (see Architecture → "Store migration strategy"):
  - Hydrate `AppState` from Supabase on login.
  - Each action: optimistic in-memory update → persist to Supabase → reconcile.
  - Subscribe to Realtime `postgres_changes` for the household; apply + `emit()`.
  - Keep a `localStorage` cache for instant load / offline tolerance.
- **One-time migration**: if local `mealmesh.state.v1` exists and the household is empty,
  offer to import it (reuse the `exporter.ts` shapes).
- Loading/empty/offline states in the UI.

**Acceptance**
- A plan edited on device A appears on device B (logged in as a family member) without manual
  refresh; favorites and shopping check-offs sync too.
- Refresh/relaunch restores state from the cloud.
- Existing local data can be imported once; JSON export/import still works.

**Touches:** `app/src/lib/store.ts` (internals), `app/src/components/*` (minimal — only async
loading states), `supabase/migrations/`.

---

## M3 — Cooked tracking & feedback (M)
**Goal:** Record which recipes were made with simple feedback; surface reuse. **Requirement 3.**

**Scope / tasks**
- Migration `0003_cook_log.sql`: `cook_log` table (+ RLS, index).
- `app/src/lib/history.ts`: write a cook event; query "last made / times made" per recipe.
- **Mark-as-made** action on a planned meal (in `PlannerView`) → records `cook_log` with
  optional quick feedback: thumbs (`make_again`) and/or 1–5 `rating`, optional note.
- Surface history in `RecipeCard` / `RecipeDetailModal` / browser: "Made 3× · last Jun 2",
  and flag not-recently-made recipes to aid rotation.
- Optional: a lightweight "History" view listing recent cooks.

**Acceptance**
- Marking a planned meal "made" records it with feedback; recipe cards show last-made and
  times-made; the same data is visible to other family members.

**Touches:** new `app/src/lib/history.ts`, `app/src/components/PlannerView.tsx`,
`RecipeCard.tsx`, `RecipeDetailModal.tsx`, `supabase/migrations/`.

---

## M4 — Hardening & polish (M)
**Goal:** Production-ready security, resilience, and docs.

**Scope / tasks**
- `app/netlify.toml`: SPA redirect + security headers + HSTS (see [`security.md`](./security.md)).
- Tighten CSP to the Supabase origin (REST + `wss:` Realtime); verify in the browser.
- Error boundaries, retry/backoff on Supabase calls, friendly offline messaging.
- Tests: store sync logic, history queries, auth-gate rendering; keep `vitest` green.
- Run the [`security.md`](./security.md) pre-launch checklist; update docs as needed.

**Acceptance**
- Security checklist passes; headers present; tests/lint green; app handles offline and error
  states gracefully.

---

## Dependency order
`M0 → M1 → M2 → M3 → M4`. M3 depends on M2 (needs cloud state + auth). M4 can absorb small
items as they arise but is gated last.

## Out of scope (noted, not planned here)
- Sending the shopping list to Mariano's/Kroger (separate effort; prompt drafted earlier).
- Moving the 278 read-only recipes into the database.
- Multi-household / public multi-tenant features beyond the single family.
