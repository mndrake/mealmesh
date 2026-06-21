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
   recipe in tiers:
   - **schema.org JSON-LD** (`extractJsonLdRecipe`) — reliable and free; most recipe sites
     embed a `Recipe` object. Handles `@graph`, ISO-8601 durations, `recipeYield`, nested
     `HowToStep`/`HowToSection` instructions, and `NutritionInformation`.
   - **Claude from page text** (`extractRecipeWithClaude`, model `claude-opus-4-8`,
     structured output) when our fetch succeeded but the page has no usable JSON-LD.
   - **Claude web-fetch** (`extractRecipeViaWebFetch`) when our own fetch is *blocked*
     (anti-bot 403, JS-rendered pages). Claude fetches the page itself via the server-side
     `web_fetch_20260209` tool, scoped to the target host (`allowed_domains`) and bounded
     (`max_uses`). Reported back to the client as `via: "ai_fetch"`.
   The Claude tiers only run when `ANTHROPIC_API_KEY` is set; without it, JSON-LD still works.
4. Either path produces a complete **draft `Recipe`** (`toDraftRecipe`): ids, store sections
   (`guessSection` / Claude-assigned), perishable flags, and defaulted nutrition (flagged
   `estimated` when the source had none). It is **not** saved server-side.
5. **Image** (best-effort, never blocks the import): the function re-hosts a photo so the app
   serves it from our own origin. It uses the page's image (JSON-LD `image` → `og:image` →
   Claude's `image_url`); if none, it asks Claude to **web-search** for a representative,
   openly-licensed image (`findRecipeImageUrl`). The chosen URL is downloaded (SSRF-guarded,
   image content-type, ≤5 MB) and uploaded to the `recipe-images` Storage bucket; the public
   URL becomes `imageUrl`. The review form shows the image with a **Remove** button.
6. The user **reviews/edits** the draft (image, title, meal, cuisine, servings, ingredient
   lines + section, method, notes) and saves. `actions.addUserRecipe` writes it to
   `user_recipes` (optimistic + cloud write-through, like the rest of the synced state).

Saved recipes appear in Browse, the planner picker, the shopping list, nutrition roll-ups,
and cooking history exactly like bundled recipes — they're merged in
`app/src/lib/allRecipes.ts`. **Plan auto-generation** still runs on the bundled set only
(imported recipes aren't parity-bound); they're added to plans manually.

## Data

`supabase/migrations/0010_user_recipes.sql` — `user_recipes(id text pk, household_id,
data jsonb, source_url, created_by, created_at, updated_at)`, RLS by household + Realtime.
The full `Recipe` lives in `data`; the row `id` (a `u-…` uuid) is authoritative.

`supabase/migrations/0012_recipe_images_bucket.sql` — a public `recipe-images` Storage
bucket (5 MB / image types only). Uploads go through the service role (the function), so no
write policy is needed; public read is what the `<img>` tag needs. Images are keyed
`<householdId>/<recipeId>.<ext>`.

## Security notes

- **`ANTHROPIC_API_KEY`** is a Netlify **function-env** secret — never client-side, never
  `VITE_`-prefixed, never committed. If absent, JSON-LD import still works; only the AI
  fallback is disabled (`422 no_structured_data`).
- **SSRF guard** (`isSafeImportUrl`): only `http(s)` to public hosts; localhost, `*.local`,
  loopback, and private/link-local IPv4 (incl. `169.254.169.254` cloud metadata) are
  rejected before any fetch. The fetch follows redirects, caps the body (3 MB) and time
  (12 s), and requires an HTML content-type.
- **Images are re-hosted, not hotlinked.** The function downloads the chosen image
  server-side (SSRF-guarded, image content-type, ≤5 MB) and re-hosts it in Supabase Storage,
  so the app loads images from our own `*.supabase.co` origin. The CSP `img-src` adds only
  that host (no broad `https:` allowance); links don't rot when source sites change. Bad
  AI-found images can be dropped in review. *Known gap:* a deleted recipe's image isn't yet
  removed from Storage (small, family-scale; cleanup deferred).
- **Rate limit.** The endpoint is capped per household (default **20 imports / rolling
  hour**) to bound Anthropic spend and fetch abuse. It's durable (Supabase
  `recipe_import_log`, migration 0011) so it holds across stateless function instances;
  decision logic is the pure, tested `importRateDecision`. Over quota returns `429` with a
  `Retry-After` header. Checked after URL validation (malformed requests don't burn quota)
  and before any fetch/AI work. If the table isn't present yet it degrades open (still
  auth-gated). Tune via `IMPORT_LIMIT` / `IMPORT_WINDOW_MS` in `recipe-import.ts`.

## Batch import (maintainer tool)

For bulk work, `npm run import:recipes` (`app/scripts/import-recipes.ts`, run via `tsx`)
scrapes + parses a list of URLs and **verifies each ingredient against Kroger** — reusing
the exact same pure helpers as the runtime importer, plus the Kroger product search. For each
ingredient it records availability and, on a confident match, sets `buy_as` (the store
product name) and the Kroger `section` (`krogerDepartmentToSection`). It writes two files for
review/commit:

- `scripts/out/imported-recipes.json` — the verified draft recipes.
- `scripts/out/import-report.md` — per-recipe table flagging unavailable / unmatched
  ingredients (the items worth fixing before they hit a shopping list).

```
npm run import:recipes -- --urls urls.txt --location 01400943   # verify at a store
npm run import:recipes -- https://site/r1 https://site/r2 --no-ai
npm run import:recipes -- --urls urls.txt --push --household <uuid>   # upsert to user_recipes
```

Env (all optional except as noted): `ANTHROPIC_API_KEY` (AI fallback), `KROGER_CLIENT_ID` /
`KROGER_CLIENT_SECRET` (verification; needs `--location`), `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` (only for `--push`). The git diff of the emitted JSON/report is
the review trail. This is a developer tool — it is **not** wired into the deployed app.

## Not (yet) built

- Import **by image** (Claude vision) and **by template/paste** — the shared table + review
  form support them; they'd just add new front doors. Deferred per the import scoping.
- De-duplication across imports (same `source_url` can be imported twice).
