// Per-day and per-week nutrition roll-ups for a plan.
import type { Plan, PlanDay, Nutrition, Recipe } from "./types";

export const ZERO: Nutrition = { kcal: 0, carb_g: 0, fiber_g: 0, protein_g: 0, fat_g: 0 };

function add(a: Nutrition, b: Nutrition): Nutrition {
  return {
    kcal: a.kcal + b.kcal,
    carb_g: a.carb_g + b.carb_g,
    fiber_g: a.fiber_g + b.fiber_g,
    protein_g: a.protein_g + b.protein_g,
    fat_g: a.fat_g + b.fat_g,
  };
}

function round(n: Nutrition): Nutrition {
  return {
    kcal: Math.round(n.kcal),
    carb_g: Math.round(n.carb_g),
    fiber_g: Math.round(n.fiber_g),
    protein_g: Math.round(n.protein_g),
    fat_g: Math.round(n.fat_g),
  };
}

/** Sum a single day's meals. Canned snack strings (no recipe) contribute nothing.
 *  Returns the total and whether any contributing recipe used estimated nutrition. */
export function dayTotals(
  day: PlanDay,
  byId: Map<string, Recipe>
): { total: Nutrition; estimated: boolean } {
  let total = ZERO;
  let estimated = false;
  for (const slot of ["breakfast", "lunch", "dinner", "snack"] as const) {
    const ref = day[slot];
    if (!ref || typeof ref === "string") continue;
    const r = byId.get(ref.id);
    if (!r) continue;
    total = add(total, r.nutrition_per_serving);
    if (r.nutrition_estimated) estimated = true;
  }
  return { total: round(total), estimated };
}

export function weekTotals(
  plan: Plan,
  byId: Map<string, Recipe>
): { total: Nutrition; estimated: boolean } {
  let total = ZERO;
  let estimated = false;
  for (const day of plan) {
    const dt = dayTotals(day, byId);
    total = add(total, dt.total);
    estimated = estimated || dt.estimated;
  }
  return { total: round(total), estimated };
}
