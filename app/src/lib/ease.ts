// "Ease" metrics: how simple a plan is to actually shop, cook, and maintain.
// The thing that makes a meal plan sustainable (vs. a one-off week of distinct,
// ingredient-heavy recipes) is a SMALL ingredient palette reused across meals —
// you buy a handful of staples in bulk and recombine them. These helpers measure
// that, and the planner's `minimizeIngredients` mode optimizes for it.
import type { Recipe, Ingredient } from "./types";

/** The distinct shopping keys a recipe contributes — the same buy_as||item key the
 *  shopping list aggregates on, skipping items excluded from shopping. Staples
 *  (salt, oil, spices you already own) are excluded: they don't grow the weekly buy. */
export function shoppableItems(r: Recipe): Set<string> {
  const s = new Set<string>();
  for (const ing of r.ingredients ?? []) {
    if (ing.exclude_from_shopping || ing.staple) continue;
    s.add(keyOf(ing));
  }
  return s;
}

function keyOf(ing: Ingredient): string {
  return ing.buy_as || ing.item;
}

/** How many distinct things you must buy/manage for one recipe. Lower = simpler. */
export function recipeComplexity(r: Recipe): number {
  return shoppableItems(r).size;
}

export interface PlanEase {
  /** Distinct ingredients across the whole plan — the size of the shopping palette. */
  paletteSize: number;
  /** Total ingredient slots used (sum over meals) — counts reuse. */
  totalUses: number;
  /** Distinct meals (recipes) contributing. */
  meals: number;
  /** Average distinct ingredients per meal. */
  avgPerMeal: number;
  /** totalUses / paletteSize: how many times the average ingredient is reused.
   *  Higher = a tighter, more bulk-buyable palette (Gemini-style). 0 if empty. */
  reuse: number;
}

/** Measure a set of cooked meals. Pass the same recipes you'd build a shopping list
 *  from (e.g. cookedMeals(plan, byId)) so palette size matches the real buy. */
export function planEase(meals: Recipe[]): PlanEase {
  const palette = new Set<string>();
  let totalUses = 0;
  for (const r of meals) {
    const items = shoppableItems(r);
    totalUses += items.size;
    for (const k of items) palette.add(k);
  }
  const paletteSize = palette.size;
  return {
    paletteSize,
    totalUses,
    meals: meals.length,
    avgPerMeal: meals.length ? totalUses / meals.length : 0,
    reuse: paletteSize ? totalUses / paletteSize : 0,
  };
}
