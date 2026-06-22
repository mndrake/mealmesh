# Recipe generation (ultra-simple diabetic recipes)

The bundled recipes are rich but ingredient-heavy — fine as one-offs, too complex to sustain
a monthly menu (a week of them pulls in ~95 distinct ingredients). This feature asks Claude
for **novel, ultra-simple, diabetic recipes** (few shoppable ingredients, net-carb bounded,
reusing a shared bulk-buy palette), then folds the good ones into the curated set so the
ease-mode planner and monthly plan can build from them.

## How it works

It reuses the M6 recipe-import pipeline (see [`recipe-import.md`](./recipe-import.md)):

- **`netlify/functions/_shared/recipe-generate.ts`** (pure, unit-tested) — the constraints
  (`GenConstraints`: role, count, `maxIngredients`, `maxNetCarbs`, `palette`, `noFish`,
  `servings`), the prompt builders, the Zod `GeneratedBatchSchema`, and:
  - `toGeneratedDraft()` — finalizes one recipe into the same `DraftRecipe` the importer
    produces (via `toDraftRecipe`), then sets the planner fields (`prep_style`,
    `office_friendly`, `batch`), flags pantry staples (`isPantryStaple`) so they don't inflate
    the shopping palette, marks `nutrition_estimated`, and tags it `generated`/`diabetic-friendly`.
  - `validateGenerated()` — drops/flags recipes that broke the rules (too many shoppable
    ingredients, net carbs over target, missing nutrition, contains fish when `noFish`).
- **`anthropic.ts` → `generateRecipesWithClaude()`** — the Claude call (`claude-opus-4-8`,
  structured output), parallel to `extractRecipeWithClaude`.

Generated recipes carry a `u-` id and land in `user_recipes`, so they appear in Browse, the
planner picker, shopping, nutrition, and Kroger exactly like imported recipes. The **Monthly
plan** view builds from the merged set (`user_recipes` + bundled), and ease mode prefers the
recipe that adds the fewest new ingredients — so adding simple generated recipes makes the
generated plan simpler. The parity-locked **default weekly** planner still builds from the
bundled set only.

## Maintainer script (generate → review → curate)

```
npm run generate:recipes -- --role breakfast --count 6 --max-net-carbs 12 --max-ingredients 5
npm run generate:recipes -- --role lunch --palette "chicken breast,romaine,cucumber,feta,olive oil"
npm run generate:recipes -- --role dinner --no-fish --push --household <uuid>
```

Writes `scripts/out/generated-recipes.json` (kept recipes) and `scripts/out/generated-report.md`
(per-recipe ingredient count, net carbs, flags). The git diff of those files is the review
trail; `--push --household <uuid>` upserts the kept recipes into `user_recipes`.

Env: `ANTHROPIC_API_KEY` (required), `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (only for
`--push`). Like `import:recipes`, this is a maintainer tool — not wired into the deployed app.

## Not (yet) built

- An in-app "Generate recipes" front door (Netlify function + review modal). The shared core,
  schema, and `user_recipes` flow already support it; it would mirror `ImportRecipeModal` and
  add per-household rate limiting (reuse `importRateDecision`).
