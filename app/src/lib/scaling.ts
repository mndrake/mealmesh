// Per-person quantity scaling for shopping. A recipe lists ingredients for its own
// `servings`; a plan may need a different number of portions: every person eats one
// serving per meal, and a batch-cooked meal feeds several days. So the portions a cooked
// recipe must yield = (day-slots it covers across the plan) × household size, and we scale
// its ingredient quantities by portions / servings. This both sizes the list to the
// household AND fixes the under-count of batch meals (cooked once, eaten all week).
//
// Used by the monthly plan's shopping (which has a household-size control); the
// parity-locked default weekly shopping stays unscaled.
import type { Plan, Recipe } from "./types";

const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;

/** A copy of the recipe with every ingredient quantity multiplied by `factor`
 *  (null quantities — "to taste" — stay null). Only ingredients change; nutrition is
 *  per-serving and untouched. */
export function scaleRecipe(r: Recipe, factor: number): Recipe {
  return {
    ...r,
    ingredients: r.ingredients.map((i) => ({
      ...i,
      qty: i.qty == null ? i.qty : i.qty * factor,
    })),
  };
}

/** How many day-slots each recipe occupies across the plan (cooked + leftover) — i.e. how
 *  many person-meals it must cover before multiplying by household size. */
export function coverageByRecipe(plan: Plan): Map<string, number> {
  const cov = new Map<string, number>();
  for (const day of plan) {
    for (const slot of SLOTS) {
      const ref = day[slot];
      if (!ref || typeof ref === "string") continue;
      cov.set(ref.id, (cov.get(ref.id) ?? 0) + 1);
    }
  }
  return cov;
}

/** Scaled recipes ready for buildList: one entry per distinct cooked recipe (leftovers
 *  fold into the batch it came from), each scaled so the cook yields enough portions for
 *  the whole household across every day it covers. Pass the result to buildList. */
export function scaledShoppingMeals(
  plan: Plan,
  byId: Map<string, Recipe>,
  householdSize: number
): Recipe[] {
  const cov = coverageByRecipe(plan);
  const out: Recipe[] = [];
  const seen = new Set<string>();
  for (const day of plan) {
    for (const slot of SLOTS) {
      const ref = day[slot];
      if (!ref || typeof ref === "string" || ref.leftover || seen.has(ref.id)) continue;
      seen.add(ref.id);
      const r = byId.get(ref.id);
      if (!r) continue;
      const portions = (cov.get(ref.id) ?? 1) * Math.max(1, householdSize);
      const factor = r.servings > 0 ? portions / r.servings : 1;
      out.push(scaleRecipe(r, factor));
    }
  }
  return out;
}
