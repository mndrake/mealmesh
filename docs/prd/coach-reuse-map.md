# Coach Mode — reuse map (PRD requirement → existing asset vs. net-new)

Companion to [`MealMesh_v2_Coach_PRD.md`](./MealMesh_v2_Coach_PRD.md). Turns the PRD's
"reuses existing infrastructure" claim into a concrete checklist, validated against the repo
(June 2026). Status legend: ✅ exists / reuse · 🟡 partial · 🔴 net-new.

## Infrastructure

| Capability | Status | Where / note |
|---|---|---|
| Frontend (React 19 + Vite + Tailwind, SPA) | ✅ | `app/` |
| Backend = Netlify Functions (TS) | ✅ | `app/netlify/functions/*` — **not** FastAPI |
| Auth + per-household model | ✅ | Supabase magic-link; `getUser`/`householdIdFor` in `_shared/supa.ts` |
| Claude layer (server-side key, structured output) | ✅ | `_shared/anthropic.ts`, `messages.parse` + `zodOutputFormat`, `claude-opus-4-8`/`claude-haiku-4-5` |
| Per-household AI rate limiting | ✅ | `checkImportRateLimit` in `_shared/supa.ts` |
| Kroger cart-building | ✅ | `kroger-*.ts` (M5) — for fast-follow `match_sku` |
| Recipe data (read-only, bundled) | ✅ | `src/data/recipes.json`; **no step/doneness fields** |
| Spoonacular | — | does not exist; recipes are curated/bundled (PRD claim removed) |

## PRD functional requirements

| Req | What it needs | Status | Plan |
|---|---|---|---|
| R1 step rendering | discrete steps per recipe | 🔴 | M0: `RecipeSteps` content asset keyed by recipe id (recipe `method` is prose) |
| R2 doneness callout | `pull_temp_f` per step | 🔴 | M0: `doneness_rules` (cited, USDA) |
| R3 sensory cue | photo-style cue per step | 🟡 | M0 schema; cue text authored, marked placeholder where not authoritative |
| R4 inline timers | durations parsed from steps | 🔴 | M0 step `timer_seconds`; M1 timer UI |
| R5 panic button | per-step Ask affordance | 🔴 | M2 `coach-ask` |
| R6 finish prompt | completion event | 🟡 | M3: extend `cook_log` (don't fork) |
| R7–R9 Orchestrator | parallel-track blueprint + timers + persistence | 🔴 | M1; persistence via existing store seam |
| R10–R12 step-aware AI | grounded doneness/technique answers | 🔴 | M2; grounding done in code, not left to model |
| R13 SSE streaming | streamed responses | 🟡→deferred | see ADR 0001 — single-round first |
| R14 medical deflection | safe bounded refusal | 🔴 | M2 intent classify → fixed response |
| R15 shopping list | categorized/scaled/A-B dedupe | ✅ | `shopping.ts`, `scaling.ts`, `listMerge.ts` |
| R16 net-carb totals | per-meal/day net carbs | 🟡 (~80%) | `nutrition.ts` + filters exist; surface in Cook Mode |

## Appendix A tools → implementation

| Tool | Plan |
|---|---|
| `check_doneness` | M2 — **deterministic code lookup** over `doneness_rules`, not model-decided (safety) |
| `explain_technique` | M2 — deterministic lookup over `techniques` |
| `swap_meal` / `generate_plan` | wrap existing `planner.ts` / `monthly.ts`; do **not** reimplement (fast-follow) |
| `scale_recipe` | reuse `scaling.ts` |
| `build_shopping_list` | reuse `shopping.ts` |
| `match_sku` | reuse Kroger `kroger-match.ts` (fast-follow) |
| `log_glucose_reading` | fast-follow; new table, not in loop scope |

## Out of scope for the build loop (cannot be completed in code)
- Legal/regulatory review of T2D positioning (§10) — product/legal task.
- The full labor-intensive Beginner content asset (§8) — only a cited seed slice is built.
- A real user beta + baseline abandonment instrumentation analysis (§13-M3) — hooks only.
