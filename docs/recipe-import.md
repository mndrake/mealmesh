# Recipe import (by URL)

Lets the household add their own recipes alongside the bundled read-only set. Imported
recipes are **mutable, per-household data** (the bundled 278 recipes stay read-only and
bundled — see [`architecture.md`](./architecture.md)), so they live in Supabase and are
merged into the app's recipe lookup at runtime.

## How it works

1. **Browse → “+ Import recipe”** opens `ImportRecipeModal`. The user pastes a recipe URL.
2. The SPA calls **`POST /api/recipes/import`** (Netlify function `recipe-import`), authed
   with the Supabase session JWT.
3. The function fetches the page server-side (SSRF-guarded, size/time-capped) and extracts a
   recipe in two tiers:
   - **schema.org JSON-LD** (`extractJsonLdRecipe`) — reliable and free; most recipe sites
     embed a `Recipe` object. Handles `@graph`, ISO-8601 durations, `recipeYield`, nested
     `HowToStep`/`HowToSection` instructions, and `NutritionInformation`.
   - **Claude fallback** (`extractRecipeWithClaude`, model `claude-opus-4-8`, structured
     output) for pages without usable JSON-LD. Only runs when `ANTHROPIC_API_KEY` is set.
4. Either path produces a complete **draft `Recipe`** (`toDraftRecipe`): ids, store sections
   (`guessSection` / Claude-assigned), perishable flags, and defaulted nutrition (flagged
   `estimated` when the source had none). It is **not** saved server-side.
5. The user **reviews/edits** the draft (title, meal, cuisine, servings, ingredient lines +
   section, method, notes) and saves. `actions.addUserRecipe` writes it to `user_recipes`
   (optimistic + cloud write-through, like the rest of the synced state).

Saved recipes appear in Browse, the planner picker, the shopping list, nutrition roll-ups,
and cooking history exactly like bundled recipes — they're merged in
`app/src/lib/allRecipes.ts`. **Plan auto-generation** still runs on the bundled set only
(imported recipes aren't parity-bound); they're added to plans manually.

## Data

`supabase/migrations/0010_user_recipes.sql` — `user_recipes(id text pk, household_id,
data jsonb, source_url, created_by, created_at, updated_at)`, RLS by household + Realtime.
The full `Recipe` lives in `data`; the row `id` (a `u-…` uuid) is authoritative.

## Security notes

- **`ANTHROPIC_API_KEY`** is a Netlify **function-env** secret — never client-side, never
  `VITE_`-prefixed, never committed. If absent, JSON-LD import still works; only the AI
  fallback is disabled (`422 no_structured_data`).
- **SSRF guard** (`isSafeImportUrl`): only `http(s)` to public hosts; localhost, `*.local`,
  loopback, and private/link-local IPv4 (incl. `169.254.169.254` cloud metadata) are
  rejected before any fetch. The fetch follows redirects, caps the body (3 MB) and time
  (12 s), and requires an HTML content-type.
- **Images aren't re-hosted.** Imported recipes set `imageUrl: null` rather than loading an
  arbitrary remote image — the CSP `img-src` stays scoped (self + Kroger hosts), so no CSP
  change was needed.
- **Rate limit.** The endpoint is capped per household (default **20 imports / rolling
  hour**) to bound Anthropic spend and fetch abuse. It's durable (Supabase
  `recipe_import_log`, migration 0011) so it holds across stateless function instances;
  decision logic is the pure, tested `importRateDecision`. Over quota returns `429` with a
  `Retry-After` header. Checked after URL validation (malformed requests don't burn quota)
  and before any fetch/AI work. If the table isn't present yet it degrades open (still
  auth-gated). Tune via `IMPORT_LIMIT` / `IMPORT_WINDOW_MS` in `recipe-import.ts`.

## Not (yet) built

- Import **by image** (Claude vision) and **by template/paste** — the shared table + review
  form support them; they'd just add new front doors. Deferred per the import scoping.
- De-duplication across imports (same `source_url` can be imported twice).
