# CLAUDE.md — MealMesh

Guidance for Claude Code working in this repo.

## What this is
A meal-planning web app built on a read-only recipe dataset. It is evolving from a
single-user, localStorage-only SPA into a **Netlify-hosted, shared single-family app** with
magic-link login, Supabase-synced state, and recipe-history tracking.

**Read the planning docs before non-trivial work:** [`docs/README.md`](docs/README.md) →
architecture, data model, security, and the M0–M4 roadmap. Confirmed stack:
**Supabase** (Postgres + Auth + RLS + Realtime) + **magic-link, invite-only** auth.

## Layout
- `app/` — the Vite + React 19 + TypeScript SPA (all app work happens here).
  - `src/lib/` — pure logic: `planner.ts`, `shopping.ts`, `normalize.ts`, `nutrition.ts`,
    `filters.ts` (framework-free; avoid changing behavior), plus `store.ts` (state) and
    `types.ts` (shared types).
  - `src/components/` — React UI (`App.tsx`, `PlannerView`, `BrowseView`, `ShoppingView`, …).
  - `src/data/recipes.json` — generated at build; do not edit by hand.
  - `scripts/build-data.mjs` — bundles `recipe-repo/` markdown into `recipes.json`.
- `recipe-repo/` — **read-only** source recipe data (git-ignored locally). Never write here.
- `docs/` — architecture & milestone planning (source of truth for the cloud migration).

## Commands (run inside `app/`)
- `npm run dev` — dev server (runs `build:data` first via `predev`).
- `npm run build` — typecheck + production build.
- `npm run test` — Vitest (runs `build:data` first via `pretest`).
- `npm run lint` — ESLint.
- `npm run build:data` — regenerate `src/data/recipes.json` from `recipe-repo/`.

## Conventions
- TypeScript throughout; match the existing concise, comment-light style.
- **Keep the `store.ts` public API stable** (`useStore` + `actions`). The Supabase migration
  swaps the persistence *internals* behind that seam — prefer that over editing every
  component. See `docs/architecture.md` → "Store migration strategy".
- Recipes are read-only reference data and stay bundled; only mutable, shared, per-household
  state goes to Supabase.
- **Secrets:** only `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` may reach the client. The
  `service_role` key must never be committed, logged, or put in the frontend/Netlify build.
  Keep `app/.env*` out of git.
- Run `npm run test` and `npm run lint` before committing app changes.

## Where things are going
Work milestone by milestone per [`docs/roadmap.md`](docs/roadmap.md). Each milestone keeps
`main` deployable.
