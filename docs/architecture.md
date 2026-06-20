# Architecture

## Current state (as built)

MealMesh today is a **fully client-side React 19 + TypeScript SPA** built with Vite,
living in `app/`. There is no backend, no auth, and no network calls.

- **Recipes** are bundled at build time: `scripts/build-data.mjs` parses the read-only
  `recipe-repo/` markdown into `app/src/data/recipes.json` (278 recipes). Recipes are
  immutable and shipped with the bundle.
- **State** lives in `localStorage` under key `mealmesh.state.v1`, managed by a tiny
  store in [`app/src/lib/store.ts`](../app/src/lib/store.ts):
  - `AppState = { activePlan, savedPlans, favorites, checked, locked }`
  - Components read via `useStore(selector)` (a `useSyncExternalStore` hook) and mutate
    via the `actions` object. **This indirection is the key seam for the migration.**
- **Core logic** is pure and framework-free: `planner.ts`, `shopping.ts`, `normalize.ts`,
  `nutrition.ts`, `filters.ts`. None of it needs to change.
- **Export/import** (`exporter.ts`) downloads plan/state as JSON or text. We reuse this to
  migrate existing local data into the cloud.

```
recipe-repo/ (read-only md)
   │ build-data.mjs (build time)
   ▼
app/src/data/recipes.json ──► React SPA ──► localStorage (mealmesh.state.v1)
```

## Target state

Keep the SPA static on **Netlify**, and add **Supabase** as the backend for auth and
synced state. Recipes stay bundled (they are read-only reference data — no reason to move
278 records into the DB). Only **mutable, shared, per-household state** moves to Supabase.

```
                         ┌──────────────────────────────────────┐
   Netlify (static SPA)  │  React SPA (Vite build)              │
   + security headers    │   • recipes.json (bundled, readonly) │
                         │   • supabase-js client (URL+anon key)│
                         └───────┬──────────────────────────────┘
                                 │ HTTPS (JWT from magic-link auth)
                                 ▼
                    ┌────────────────────────────────────┐
                    │ Supabase                            │
                    │  • Auth (magic link, invite-only)   │
                    │  • Postgres + Row-Level Security    │
                    │  • Realtime (postgres_changes)      │
                    └────────────────────────────────────┘
```

### Why this shape
- **Static frontend stays static.** No SSR/server to run; Netlify just serves the build.
  The browser talks to Supabase directly using the **publishable anon key** — safe because
  Row-Level Security (RLS) enforces all access server-side. See [`security.md`](./security.md).
- **Supabase fits the data.** Plans/history are relational and benefit from SQL + RLS and
  built-in Realtime for the "see it on another device" requirement.
- **Minimal blast radius in the app.** Because every component already goes through
  `useStore`/`actions`, we swap the persistence layer *behind that same API* rather than
  touching every component. See "Store migration" below.

## Components & responsibilities

| Layer | Tech | Responsibility |
| --- | --- | --- |
| Hosting | Netlify | Serve static build, security headers, SPA redirects, env injection at build. |
| Auth | Supabase Auth | Magic-link sign-in, session/JWT, invite-only allowlist. |
| Data | Supabase Postgres + RLS | Households, plans, favorites, shopping check-offs, cook log. |
| Sync | Supabase Realtime | Push plan/check-off/favorite changes to other logged-in devices. |
| App | React 19 + Vite (`app/`) | UI, planning/shopping logic (unchanged), Supabase-backed store. |
| Build data | `scripts/build-data.mjs` | Bundle read-only recipes (unchanged). |

## Store migration strategy (the central change)

Today `store.ts` is a synchronous, localStorage-backed singleton exposing `useStore` and
`actions`. The plan is to **preserve that public surface** and replace the internals:

1. **Auth gate.** Add an `AuthProvider` and a login screen; the app shell renders only when
   a session exists. New module `app/src/lib/supabase.ts` creates the client from
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
2. **Remote store.** Reimplement `store.ts` to hydrate `AppState` from Supabase on login,
   keep the in-memory snapshot + `useSyncExternalStore` exactly as now, and have each
   `action` write through to Supabase (optimistic update → persist → reconcile).
3. **Realtime.** Subscribe to `postgres_changes` for the household's plan / favorites /
   check-offs; apply incoming changes to the in-memory snapshot and `emit()`.
4. **Offline cache.** Keep writing the snapshot to `localStorage` as a cache for instant
   load and offline tolerance; treat Supabase as source of truth on reconnect.
5. **One-time migration.** On first authenticated load, if local `mealmesh.state.v1` exists
   and the household has no data yet, offer to import it (reuse `exporter.ts` shapes).

Net effect: `planner.ts`, `shopping.ts`, and most components are untouched; the work
concentrates in `store.ts`, a new `supabase.ts`, an auth shell, and the new cook-tracking UI.

## Data flow examples
- **Plan a week (device A):** user edits a slot → `actions.setSlot` → optimistic in-memory
  update + `emit()` → upsert to `plans.data` (JSONB) in Supabase.
- **See it (device B):** B is subscribed to the household's `plans` row via Realtime →
  receives the change → updates snapshot → UI re-renders. No refresh needed.
- **Mark cooked + feedback:** user marks a planned dinner "made" → insert into `cook_log`
  with optional rating/`make_again` → recipe cards query "last made / times made".

## Environments
- **Local dev:** `npm run dev` in `app/` against a Supabase dev project (env in `app/.env.local`).
- **Production:** Netlify build with env vars set in the Netlify dashboard; production
  Supabase project. See [`security.md`](./security.md) for env/secret rules.
