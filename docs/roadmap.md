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

## M3 — Cooked tracking & feedback (M) — ✅ DONE
**Goal:** Record which recipes were made with simple feedback; surface reuse. **Requirement 3.**

**Shipped:** `0005_cook_log.sql` (RLS + index + Realtime); `cook_log` integrated into the
store behind the stable `useStore`/`actions` seam (`markCooked`, `deleteCookEvent`, hydrate +
optimistic + reconcile + Realtime + local cache + import/export). Pure `history.ts`
("made N× · last …", recents, formatting) with unit tests. **Mark-as-made** modal
(date/thumbs/1–5/notes) from the planner and recipe detail; "🍳 Made N×" on recipe cards,
detail, and planner slots; a **History** tab listing recent cooks with delete.

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

## M4 — Hardening & polish (M) — ✅ DONE
**Goal:** Production-ready security, resilience, and docs.

**Shipped:** `netlify.toml` SPA redirect + security headers + HSTS + CSP scoped to the
Supabase origin (REST + `wss:` Realtime) were already in place; added an app-level
**ErrorBoundary** (friendly fallback instead of a white screen), **offline messaging** in
`CloudStatus` (online/offline aware; edits saved locally and synced on reconnect), and
tests for history derivations, cook-log mapping, and the `markCooked` store path; smoke test
covers the History view. The store already does optimistic-write + reconcile-on-error with a
manual retry. (Remaining nice-to-haves: automatic exponential backoff on writes and a full
`security.md` pre-launch sign-off.)

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

## M5 — Send shopping list to Mariano's / Kroger (PULLED FORWARD) — ✅ DONE
**Goal:** one-tap **"build my Mariano's cart"** from the weekly shopping list.
Full design in [`kroger-integration.md`](./kroger-integration.md).

Pulled out of "out of scope" now that the backend exists. Netlify **Functions** host the
Kroger OAuth broker + API proxy; the **Supabase** household + a `kroger_connection` table hold
the (encrypted) per-household Kroger tokens. Achievable outcome is **cart-building** — items
land pre-added; the one-time Kroger account login and final checkout stay manual (no public API
places or pays for an order).

**Phases (PRs):** (1) `kroger_connection` table + Netlify function skeleton + OAuth
(authorize / callback / refresh, gated by the Supabase session JWT); (2) Locations (pick the
Mariano's store) + Products search proxy + pure match-shaping with unit tests; (3) "Send to
Mariano's" UI on the shopping list (connect → pick store → review/swap → send → open cart).

**External dependency (long pole):** a Kroger **Production** developer app with the
`cart.basic:write` scope — self-serve registration (see kroger-integration.md → Prerequisites).

## M6 — Recipe import (by URL) — ✅ DONE
**Goal:** let the household add their own recipes alongside the bundled read-only set.
Full design in [`recipe-import.md`](./recipe-import.md).

Imported recipes are mutable per-household data, so they get a Supabase `user_recipes` table
(migration 0010) and are merged into the app's recipe lookup at runtime
(`app/src/lib/allRecipes.ts`) — bundled recipes stay read-only and still drive plan
generation. A Netlify function (`recipe-import`) fetches the page (SSRF-guarded) and extracts
a recipe from schema.org JSON-LD, falling back to Claude (`claude-opus-4-8`, structured
output) for pages without it. The user reviews/edits the draft before saving.

**New secret:** `ANTHROPIC_API_KEY` (Netlify function env only) powers the AI fallback;
JSON-LD import works without it. Import by image / template are deferred (the table + review
form already support them).

## M7 — Coach Mode (v2) — 🟡 FOUNDATION SHIPPED (flagged off)
**Goal:** a guided cooking experience (Cook Mode + Sunday Orchestrator + a step-aware AI
assistant) for novice cooks. Full PRD in [`prd/MealMesh_v2_Coach_PRD.md`](./prd/MealMesh_v2_Coach_PRD.md),
reuse map in [`prd/coach-reuse-map.md`](./prd/coach-reuse-map.md), assistant architecture in
[`adr/0002-coach-assistant-single-round.md`](./adr/0002-coach-assistant-single-round.md).

Everything is behind the **`VITE_COACH_MODE`** flag (default off) so it's invisible on the
live app until enabled. The buildable software slice is in:
- **Content asset** (`app/src/data/coach/`, `app/src/lib/coach/`): cited USDA doneness rules,
  techniques, per-recipe steps, batch blueprints; pure `checkDoneness` (rule overrides
  observation) shared by SPA + function.
- **Month-1 rotation** (`menus.json`, `menu-recipes.json`): the PRD MVP target — two
  selectable weekly menus (A/B), 14 guided recipes authored from `T2D_Beginner_Edition.md`,
  each with steps/doneness/timers, plus a Sunday prep blueprint per menu.
- **Cook Mode + Orchestrator** (`app/src/components/coach/`): pick a week → cook each meal
  step-at-a-time (doneness callout, timers, finish prompt) or run the parallel-track Sunday
  prep timeline.
- **Assistant** (`netlify/functions/coach-ask.ts`): single-round, server-grounded, Haiku
  phrasing, medical deflection, no-AI safety fallback.
- **Instrumentation**: `cook_log.source = 'cook_mode'` feeds the completion North Star.

**Deploy prerequisites (do NOT auto-apply on merge):**
1. Apply migrations **0016** (`coach_ask_log`) and **0017** (`cook_log.source`) to Supabase.
2. Set **`VITE_COACH_MODE=1`** in the Netlify site env to expose the Coach tab.
3. `ANTHROPIC_API_KEY` (already set for M6) powers the assistant; without it the safety-critical
   doneness path still works from the deterministic grounding.

**Content:** all of **Months 1–4** are now authored (8 weekly menus / 56 guided recipes,
transcribed from `T2D_Beginner_Edition.md` with steps, structured ingredients, net carbs, and
a Sunday prep blueprint each). Month 1 has photos; Months 2–4 currently show a placeholder
until images are sourced.

**Not done (out of build-loop scope):** legal/regulatory review of T2D positioning, photos for
the Months 2–4 recipes, SSE streaming (ADR 0002 — deferred), and the completion-*rate*
denominator (session-start tracking).

## Dependency order
`M0 → M1 → M2 → M5 (Kroger, pulled forward) → M3 → M4`. Kroger only needs M1/M2 (auth +
deployed backend); it's independent of M3. M3 depends on M2. M4 is gated last. M6 (recipe
import) builds on M2's synced-state seam.

## Out of scope (noted, not planned here)
- Moving the 278 read-only recipes into the database.
- Multi-household / public multi-tenant features beyond the single family.
- Kroger **Partner** Carts API and any true auto-checkout (no public API places or pays for an order).
