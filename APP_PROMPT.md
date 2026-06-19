# Initial prompt for Claude Code — MealMesh meal-planning app

> Paste everything below the line into a fresh Claude Code session started in `~/Projects/mealmesh`.

---

I want to build a local meal-planning web app on top of an existing recipe dataset that already
lives in this folder at `recipe-repo/`. **Before writing any code, explore `recipe-repo/` and read
its `README.md`, `schema/recipe.json`, and a handful of files under `recipes/`** so you understand
the data, then propose a short plan and wait for my OK before implementing.

## The data (source of truth — treat `recipe-repo/` as READ-ONLY)

- **278 recipes** as Markdown-with-YAML-frontmatter in `recipe-repo/recipes/{breakfast,lunch,dinner,snack}/*.md`.
  Frontmatter holds structured data; the body has `## Method`/`## Instructions` and `## Notes`.
- Every recipe validates against `recipe-repo/schema/recipe.json`. Key fields:
  `id, title, category, cuisine, servings, serving_size, prep_minutes, cook_minutes,
  prep_style (no_cook|make_ahead|cook), office_friendly, batch, tags[],
  nutrition_per_serving {kcal, carb_g, fiber_g, protein_g, fat_g}, nutrition_estimated (bool),
  source {name,url,...}, image, image_source, ingredients[]`.
- **Structured ingredients** are the important part — each is a record:
  `{qty, unit, item, section, perishable, staple, buy_as?, note?, optional?}`.
  `section` is one of: Produce, Meat & Poultry, Dairy & Eggs, Bakery, Pantry & Dry Goods, Condiments & Spices.
- One photo per recipe in `recipe-repo/images/<id>.jpg` (480×340); attribution in `images/sources.json`.
- `recipe-repo/recipes/index.json` is a generated catalog. `recipe-repo/pantry.yaml` lists staples.
- Existing Python tooling you can read for logic to port (don't depend on it at runtime):
  `build/loader.py` (load+validate), `build/planner.py` (weekly plan: constraints + ingredient-overlap),
  `build/shopping.py` (aisle-grouped shopping list), `build/find_duplicates.py`.

### Data quirks to respect
- ~150 recipes have `nutrition_estimated: true` (auto-estimated) vs ~128 with real published values.
  **Surface this distinction in the UI** (e.g. an "est." badge) — don't present estimates as exact.
- Imported recipes store ingredients + nutrition + a `source.url` but **not** full method text;
  link out to `source.url` for the steps. Hand-authored recipes have full steps in the body.
- Tags include diet/style flags: `diabetic-friendly, low-carb, low-calorie, high-protein, vegetarian,
  no-fish, office-friendly, make-ahead, no-cook`, plus per-source tags and cuisines.

## What to build

A fast, local, single-user web app (no auth) for browsing recipes and planning weeks. MVP:

1. **Recipe browser** — grid of cards (photo, title, category, kcal/carbs/protein, key tags),
   with full-text search and filters (category, tags, cuisine, max carbs/calories, prep_style,
   max total time, vegetarian, has-real-nutrition). Recipe detail view with ingredients, nutrition,
   method (or "view source" link), and image attribution.
2. **Weekly planner** — a 7-day × {breakfast, lunch, dinner, snack} board. Add recipes by
   drag-drop or search; auto-suggest a week (port `planner.py`'s logic: honor constraints and
   maximize shared perishable ingredients). Show per-day and per-week nutrition totals.
3. **Shopping list** — aggregate the planned week's ingredients (port `shopping.py`): merge
   duplicates, normalize units, group by store section, and keep `staple` items in a separate
   "check pantry" list. Allow checking off items.
4. **Persistence** — save saved plans and favorites locally (SQLite or a JSON file in a new
   `app/data/` dir; or localStorage if you go fully client-side). Plans should be exportable.

Nice-to-haves (only after MVP works, and ask first): servings/scaling, calendar export,
"cook from what I have" search, printable plan, and a "regenerate plan" that respects locked meals.

## Tech & working style

- Propose a simple stack and explain the tradeoff in one paragraph before building. A good default:
  **Vite + React + TypeScript** front-end that loads the recipes (parse the Markdown/frontmatter at
  build time into a JSON bundle, or via a tiny local API). Keep it runnable with one `npm run dev`.
  If you prefer a small backend (e.g. FastAPI reusing the existing Python), justify it briefly.
- Put all new code in a new top-level `app/` directory. **Do not modify anything under
  `recipe-repo/`** (it's the data source and is git-versioned separately) — read from it.
- Write a data-loading layer that validates against `schema/recipe.json` and fails loudly on bad data,
  so the app stays correct as I add recipes later.
- Work incrementally: build the data layer + a few unit tests first, confirm recipes load and
  nutrition/shopping math matches the Python tools on a sample week, then build the UI.
- Add an `app/README.md` with setup/run instructions. Use git; make small, logical commits.

## Constraints & notes

- Personal/local use only; recipes were saved for personal meal-planning, and many images are
  representative Wikimedia Commons photos — keep `image_source`/attribution visible. Not for redistribution.
- Include a small disclaimer in the UI: nutrition (especially `nutrition_estimated`) is approximate
  and this is not medical advice.

Start by exploring `recipe-repo/`, then give me your proposed stack + a step-by-step plan.
