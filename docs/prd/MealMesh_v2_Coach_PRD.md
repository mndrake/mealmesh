# MealMesh v2 — "Coach Mode" PRD

| | |
|---|---|
| **Doc status** | Draft v0.2 — for design (stack claims fact-checked against repo) |
| **Owner** | Dave |
| **Last updated** | June 23, 2026 |
| **Eng stack** | React 19/Vite/Tailwind · Netlify Functions (TypeScript) · Supabase (Postgres + Auth + RLS + Realtime) · Kroger · Anthropic Claude (`@anthropic-ai/sdk`, structured output) |
| **Related work** | Beginner Edition meal-plan content (doneness chart, technique glossary, photo-style cues) — the seed content asset for this release |

---

## 1. Summary

MealMesh v2 adds a **Coach Mode**: a guided cooking experience for people who can plan a meal but can't yet reliably *cook* one. It turns the existing planning app into a step-by-step kitchen copilot, anchored by a structured doneness/technique content layer and a **step-aware AI assistant** that can answer "is this done?" mid-cook with the context of the exact recipe and step the user is on.

This is **not a new app**. It's a mode inside MealMesh that reuses the existing planner, Supabase state, Claude layer, and Kroger infrastructure (all shipped — see roadmap M0–M6). The initial content and constraint profile is the low-carb / Type 2 diabetes rotation already built, but the architecture is constraint-driven and generalizes to other diets.

> **Reuse caveat (validated against the repo, June 2026):** the only Coach-Mode capability that does *not* already exist is the step-level recipe structure and doneness/technique content asset (§8) — recipe `method` is currently plain prose with no discrete steps or doneness targets. That makes M0 (content + schema) the true critical path; nothing downstream is buildable until it lands. Net-carb tracking (R16) is ~80% built (`app/src/lib/nutrition.ts`, net-carb filters, diabetic-friendly tag, T2D recipe generation).

---

## 2. Problem

Most meal apps assume the user already knows how to cook. For a newly-diagnosed T2D user — overwhelmed, diet-restricted, and often a novice in the kitchen — the failure point isn't *deciding* what to make. It's **executing it**: undercooking protein, watery cauliflower mash, gravy that won't thicken, not knowing when shrimp is done. These small failures compound into abandonment, and abandonment undermines the whole reason they're cooking (blood-sugar control).

**The gap:** no widely-used product de-risks the *act of cooking* for beginners, in-context, at the moment of failure.

---

## 3. Goals & non-goals

### Goals
- Reduce first-month recipe **abandonment** for novice cooks.
- Make the **Sunday batch-prep** session feel manageable (parallelized, timed, guided).
- Provide **in-context, step-aware help** during cooking, grounded in safe doneness data.
- Keep net-carb visibility per meal/day for self-tracking.

### Non-goals (this release)
- Not a medical device; no dosing, no medication guidance, no clinical claims.
- No social/community features.
- No grocery delivery logistics beyond existing Kroger SKU matching.
- Not a general recipe search engine — the rotation model is intentional.

---

## 4. Target users

**Primary — "Newly-diagnosed novice."** Recently told to manage T2D with diet. Can follow a list but is intimidated by a stove. Wants to be told exactly what to do and reassured it's safe to eat. Values low decision load.

**Secondary — "Two-person household manager."** Cooks for a partner, time-constrained on weekdays, willing to invest one Sunday session. Wants batch efficiency and a tight shopping trip.

---

## 5. Success metrics

**North Star:** First-month **recipe completion rate** (started → finished and eaten), self-reported in Cook Mode.

**Supporting:**
- Sunday Orchestrator completion rate (prep sessions finished vs. started)
- Panic-button **resolution rate** (user continued cooking after asking) and time-to-answer
- Weekly active cooking days per user
- Plan adherence (meals cooked vs. planned per week)
- W4 retention

**Core hypothesis to validate:** *step-aware, in-context coaching reduces recipe abandonment vs. a static recipe view.* If beginners finish more dinners, the product works. Everything in the MVP exists to test this.

---

## 6. Scope

### MVP (validate the hypothesis)
1. **Month 1 rotation only** (two menus, 5 dinners + batch breakfast/lunch).
2. **Cook Mode** — full-screen, one step at a time, doneness temp as a primary callout, photo-style "what it looks like now" cue inline.
3. **Sunday Batch Orchestrator** — interactive parallel-task timeline with live timers.
4. **Step-aware AI assistant ("panic button")** — context = current recipe + step.
5. **Per-meal / daily net carbs**, displayed (no glucose logging yet).
6. **Manual shopping list** (categorized, scaled). **No Kroger SKU match in v1.**

### Fast-follow (post-validation)
- Full 4-month rotation + constraint-driven plan generation
- Conversational plan editing ("swap Thursday, I hate mushrooms")
- Kroger SKU match + aisle-ordered list (existing MealMesh capability)
- Optional post-meal glucose logging + per-meal trend view
- Household scaling (2 → N), additional diet profiles

### Later / explicitly deferred
- Alexa / voice cook-along (prior analysis flagged MCP voice-mode limitations)
- Additional content verticals beyond low-carb

---

## 7. Functional requirements

### 7.1 Cook Mode
- **R1.** Renders a recipe as discrete steps; one step visible at a time, large type, glanceable from across a kitchen.
- **R2.** When a step has a doneness target, the temp (e.g. **165°F**) renders as a primary visual element, not buried in prose.
- **R3.** Each applicable step shows the photo-style sensory cue ("pink, opaque, curled into a loose C").
- **R4.** Inline timers fire from step text (e.g. "sear 3–4 min/side").
- **R5.** A persistent **Ask** affordance ("panic button") on every step.
- **R6.** End-of-recipe prompt: "Did you finish this?" → feeds the North Star metric.

### 7.2 Sunday Batch Orchestrator
- **R7.** Renders the 90-minute blueprint as a parallel-track timeline (oven / stove / prep).
- **R8.** Live, concurrent timers with "what to do while you wait" surfacing (e.g. "egg bites 6 min left → chop peppers").
- **R9.** Checklist state persists if the user backgrounds the app mid-session.

### 7.3 AI assistant (step-aware)
- **R10.** Every request carries structured context: `recipe_id`, `step_id`, ingredients, and the step's doneness target.
- **R11.** Doneness questions ("is this done?") are answered **only via a tool grounded in the doneness chart** — the model must not free-generate a food-safety verdict (see §10).
- **R12.** Technique questions ("how do I dice this?") resolve against the technique/cue content layer.
- **R13.** Responses stream (SSE) for responsiveness.
- **R14.** Out-of-scope/medical questions get a bounded, safe deflection (see §10).

### 7.4 Shopping list (MVP)
- **R15.** Categorized (Produce / Meat / Pantry-Frozen), scaled to household size, A/B-week dedupe.
- **R16.** Net-carb totals visible per meal and per day.

---

## 8. The content asset (the moat)

The structured **doneness + technique + photo-style-cue layer** is the core differentiator and the thing that makes AI coaching safe and competent rather than hallucinated. Treat it as a first-class, versioned data asset, not prose baked into recipes.

**Minimum content schema:**
- `doneness_rules`: `{ food, pull_temp_f, rest_minutes, visual_cue, no_thermometer_cue }`
- `techniques`: `{ id, name, definition, stages[] }` where each stage = `{ look, sound, smell, action_cue }`
- `recipes`: steps reference `technique_id` and `doneness_rule` by key, so the assistant can ground answers.

Authoring this well is deliberately labor-intensive — that effort *is* the defensibility. Budget for it.

---

## 9. AI architecture

Reuses the MealMesh agent-layer pattern: React → **Netlify Function** → Claude (`ANTHROPIC_API_KEY` server-side only, Zod-validated structured output).

> **⚠️ Architectural gap — must spike before M2.** Today's functions (`recipe-import`, `recipe-generate`, `kroger-advise`) are **single-shot, structured-output calls** deliberately kept small to fit Netlify's **~10s synchronous timeout** (the recipe-gen 502 fix, commit `3bf4b0b`, was exactly this). The Coach assistant wants a **multi-turn tool-use loop with SSE streaming (R13)** — the opposite shape. This does *not* exist yet and is the top technical risk (§11). Candidate approaches: Netlify streaming/background functions, or stream from Anthropic to the client directly with a Function acting only as an auth-gated proxy. Pick one before building M2.

**Model routing**
- **Sonnet 4.6** — conversational coaching, plan editing, technique explanation.
- **Haiku 4.5** — cheap structured work: SKU normalization, ingredient parsing, intent classification/routing.
- Escalate to **Opus 4.8** only if Sonnet underperforms on evals — decide by measurement, not default.

**Cost levers**
- **Prompt caching** on the stable prefix (system prompt + doneness/technique corpus + tool schemas) — this repeats every turn, so cache it.
- **Batch API** for any non-interactive generation (e.g. nightly plan regeneration).

**Grounding rule (critical):** food-safety answers route through `check_doneness`, which reads the content layer. The model interprets the user's observation against returned rules; it does not invent the verdict.

---

## 10. Safety & compliance

- **Medical framing.** Position as *self-tracking + general nutrition information*, never medical advice or a diagnostic/therapeutic device. No medication or dosing logic. Surface a clear, persistent disclaimer where carbs/glucose appear. Get qualified regulatory/legal review before shipping any health-adjacent claim — this is a product risk, not a detail.
- **Food safety.** Doneness verdicts must be tool-grounded (§9). A wrong "it's done" on chicken is the one error that cannot ship. Default to the conservative temp; when user observation conflicts with the rule, the rule wins and the assistant says so.
- **Scope deflection.** Medical questions ("should I change my insulin?") get a fixed, safe response directing to their care team — handled as a classified intent, not left to free generation.
- **No ads / no model-driven product promotion** in coaching responses.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Streaming tool-use loop doesn't fit Netlify's ~10s function timeout** (the existing agent layer is single-shot; recent 502 was this exact limit) | **De-risk first:** spike Netlify streaming/background functions vs. client-direct Anthropic streaming through an auth-gated proxy. Block M2 on the decision (§9). |
| **No step/doneness schema exists** — recipe `method` is plain prose, so nothing in M1+ is groundable yet | Treat M0 (content + schema) as the hard critical path; author one recipe end-to-end to prove the schema before scaling content (§8, §13-M0). |
| Health/regulatory exposure from T2D positioning | Self-tracking framing + disclaimers + legal/regulatory review before launch |
| Model gives unsafe doneness verdict | Tool-grounded `check_doneness`; conservative default; rule overrides observation |
| Content-authoring cost stalls coverage | Ship Month 1 only for MVP; treat content as funded, versioned asset |
| AI cost scales badly with usage | Prompt caching on stable prefix; Haiku for structured calls; cache common Q&A |
| Hypothesis is wrong (coaching doesn't move abandonment) | MVP is deliberately cheap (no Kroger, one month) so the test is fast |
| Voice/hands-free demand mid-cook | Deferred; revisit after validation given known MCP voice-mode limits |

---

## 12. Open questions
- What's the baseline abandonment rate to beat? (Needs instrumentation before/at MVP.)
- Glucose logging in fast-follow vs. MVP — does seeing the spike drive retention enough to pull it forward?
- Does Cook Mode need offline resilience (kitchen wifi dead zones)?
- How much plan personalization before generation cost outweighs the rotation model's simplicity?

---

## 13. Milestones (indicative)
1. **M0 — Content + schema:** doneness/technique/cue data modeled and authored for Month 1.
2. **M1 — Cook Mode + Orchestrator:** static (no AI) end-to-end cook flow with timers.
3. **M2 — Step-aware assistant:** agent loop + `check_doneness` / `explain_technique`, SSE.
4. **M3 — Instrumentation + beta:** completion metric live; small beta to test the hypothesis.
5. **Gate:** abandonment improvement → green-lights fast-follow (full rotation, plan editing, Kroger).

---

## Appendix A — Tool schemas (for the Netlify Function agent loop)

Drop-in starting point; tighten types during build.

```json
[
  {
    "name": "check_doneness",
    "description": "Authoritative doneness verdict grounded in the doneness content layer. Use for any 'is this done / safe to eat' question. Do not answer food-safety from general knowledge.",
    "input_schema": {
      "type": "object",
      "properties": {
        "food": { "type": "string", "description": "e.g. 'chicken_breast', 'shrimp', 'ground_beef'" },
        "measured_temp_f": { "type": "number", "description": "Thermometer reading if provided" },
        "user_observation": { "type": "string", "description": "What the user sees, e.g. 'curled into a tight ring'" }
      },
      "required": ["food"]
    }
  },
  {
    "name": "explain_technique",
    "description": "Return the staged, photo-style walkthrough for a technique, scoped to the current recipe step.",
    "input_schema": {
      "type": "object",
      "properties": {
        "technique_id": { "type": "string", "description": "e.g. 'sear', 'cauliflower_mash', 'thicken_gravy'" },
        "recipe_id": { "type": "string" },
        "step_id": { "type": "string" }
      },
      "required": ["technique_id"]
    }
  },
  {
    "name": "swap_meal",
    "description": "Replace one meal in a plan while honoring all active constraints (diet, no-fish, carb ceiling, household size).",
    "input_schema": {
      "type": "object",
      "properties": {
        "plan_id": { "type": "string" },
        "day": { "type": "string" },
        "slot": { "type": "string", "enum": ["breakfast", "lunch", "dinner"] },
        "reason": { "type": "string", "description": "e.g. 'dislikes mushrooms'" }
      },
      "required": ["plan_id", "day", "slot"]
    }
  },
  {
    "name": "generate_plan",
    "description": "Generate a rotation from a constraint profile. Returns structured plan JSON for the UI to render.",
    "input_schema": {
      "type": "object",
      "properties": {
        "constraints": {
          "type": "object",
          "properties": {
            "diet": { "type": "string" },
            "exclusions": { "type": "array", "items": { "type": "string" } },
            "net_carb_ceiling_per_meal": { "type": "number" },
            "servings": { "type": "integer" },
            "weeks": { "type": "integer" }
          }
        }
      },
      "required": ["constraints"]
    }
  },
  {
    "name": "scale_recipe",
    "description": "Scale a recipe's ingredient amounts to a target serving count.",
    "input_schema": {
      "type": "object",
      "properties": {
        "recipe_id": { "type": "string" },
        "servings": { "type": "integer" }
      },
      "required": ["recipe_id", "servings"]
    }
  },
  {
    "name": "build_shopping_list",
    "description": "Produce a categorized, scaled, A/B-week-deduped shopping list for a plan.",
    "input_schema": {
      "type": "object",
      "properties": {
        "plan_id": { "type": "string" },
        "week_set": { "type": "string", "enum": ["A", "B", "both"] }
      },
      "required": ["plan_id"]
    }
  },
  {
    "name": "match_sku",
    "description": "[Fast-follow] Map an ingredient to a purchasable Kroger SKU for the user's store.",
    "input_schema": {
      "type": "object",
      "properties": {
        "ingredient": { "type": "string" },
        "store_id": { "type": "string" },
        "quantity": { "type": "string" }
      },
      "required": ["ingredient"]
    }
  },
  {
    "name": "log_glucose_reading",
    "description": "[Fast-follow] Record a self-reported post-meal reading for trend display. Self-tracking only; not medical advice.",
    "input_schema": {
      "type": "object",
      "properties": {
        "meal_id": { "type": "string" },
        "value_mg_dl": { "type": "number" },
        "minutes_after_meal": { "type": "integer" }
      },
      "required": ["meal_id", "value_mg_dl"]
    }
  }
]
```

## Appendix B — Assistant routing logic (reference)

```
classify intent (Haiku 4.5)
├─ doneness / "is it done"      → check_doneness  → ground verdict, conservative default
├─ technique / "how do I…"      → explain_technique
├─ plan edit / swap / scale     → swap_meal | scale_recipe | generate_plan
├─ shopping                     → build_shopping_list (+ match_sku, fast-follow)
├─ medical (meds/dosing/symptoms) → fixed safe deflection → care team
└─ general cooking chat         → Sonnet 4.6, free-form, no food-safety verdicts
```
