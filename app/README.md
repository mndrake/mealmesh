# MealMesh — meal-planning web app

A fast, local, single-user web app for browsing the `recipe-repo/` recipe library,
planning weeks, and generating shopping lists. Built with **Vite + React + TypeScript**,
fully client-side — no backend, no auth, no network calls.

`../recipe-repo/` is the **read-only** source of truth. This app never writes to it.

## Quick start

```bash
cd app
npm install
npm run dev          # regenerates the data bundle, then starts Vite
```

Open the printed URL (default http://localhost:5173). To build for production:

```bash
npm run build && npm run preview
```

## How the data layer works

`scripts/build-data.mjs` runs automatically before `dev`, `build`, and `test`
(`predev`/`prebuild`/`pretest`). It:

1. Reads every `recipe-repo/recipes/**/*.md` (Markdown + YAML frontmatter), in the
   **same sorted-path order** the Python tools use.
2. Validates each recipe against `recipe-repo/schema/recipe.json` with **ajv**, and
   **fails loudly** on any invalid recipe so the app stays correct as recipes are added.
3. Normalizes the two UI-critical fields the schema allows but doesn't require:
   `cuisine` (string or null) and `nutrition_estimated` (true only when explicitly set).
4. Splits each body into `method` / `notes`, flagging imported recipes whose method is
   just a link to `source.url`.
5. Emits `src/data/recipes.json` and copies each recipe's image into
   `public/recipe-images/<id>.jpg`.

Both `src/data/` and `public/recipe-images/` are generated (git-ignored); re-run
`npm run build:data` to refresh them.

## Planner & shopping parity

`src/lib/planner.ts` and `src/lib/shopping.ts` are faithful ports of
`recipe-repo/build/planner.py` and `shopping.py` — same iteration order, the same
greedy "first-max-wins" tie-breaking, the same unit families and round-half-to-even
rounding. `scripts/gen_fixtures.py` captures the Python tools' real output as golden
fixtures (`src/lib/__fixtures__/`), and `npm test` asserts the TS ports reproduce them
exactly. Re-capture fixtures (needs a Python env with `pyyaml`) via:

```bash
python -m venv .venv && .venv/bin/pip install pyyaml jsonschema
.venv/bin/python scripts/gen_fixtures.py
```

## Features

- **Browse** — card grid with full-text search (title, ingredients, cuisine, tags) and
  filters: category, diet/style tags, cuisine, prep style, max carbs / calories / total
  time, published-nutrition-only, and favorites. Recipe detail shows ingredients grouped
  by store section, per-serving nutrition (with an **est.** badge for estimates), the full
  method or a link to the source, and recipe/image attribution.
- **Plan** — a 7-day × {breakfast, lunch, dinner, snack} board. Add meals via search or
  drag, swap by dragging between cells. **Auto-suggest** ports the Python planner
  (maximizes shared perishables, honors weekday/office/batch constraints); toggle dietary
  constraints (diabetic-friendly, vegetarian, etc.). Per-day and per-week nutrition totals
  update live.
- **Shopping** — aggregates the planned week's ingredients: merges duplicates, normalizes
  units, groups by store section, and holds `staple` items in a separate "check pantry"
  list. Check items off; export as text.
- **Persistence** — the active plan, saved plans, favorites, and check-offs persist to
  `localStorage`. **Backup** downloads the full state as JSON; **Import** restores it (also
  accepts a single exported plan).

## Scripts

| command            | what it does                                            |
| ------------------ | ------------------------------------------------------- |
| `npm run dev`      | regenerate data, start the dev server                   |
| `npm run build`    | regenerate data, typecheck, production build            |
| `npm test`         | regenerate data, run parity + render smoke tests        |
| `npm run build:data` | regenerate `recipes.json` + images only               |
| `npm run lint`     | ESLint                                                   |

## Project layout

```
app/
├── scripts/
│   ├── build-data.mjs   # MD -> validated recipes.json + image copy (prebuild)
│   └── gen_fixtures.py  # capture Python golden output for parity tests
├── src/
│   ├── lib/             # data, types, planner/shopping ports, filters, nutrition, store
│   │   └── __fixtures__/ # golden output from the Python tools (committed)
│   ├── components/      # Browse / Planner / Shopping views + modals
│   └── App.tsx
```

## Disclaimer

Nutrition figures are per serving and approximate — entries marked **est.** are
auto-estimated, not lab-verified. This tool is for personal meal planning and is **not
medical or dietary advice**. Recipes and images are saved for personal use only (many
photos are representative Wikimedia Commons images); attribution is shown on each recipe.
Not for redistribution.
