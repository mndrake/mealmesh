// Per-day and per-week nutrition roll-ups for a plan.
import type { Plan, PlanDay, Nutrition, Recipe } from "./types";

export const ZERO: Nutrition = { kcal: 0, carb_g: 0, fiber_g: 0, protein_g: 0, fat_g: 0 };

/** Net carbs = total carbs minus fiber, floored at 0. The figure diabetic meal
 *  planning is usually budgeted against (fiber isn't blood-sugar-impacting), and
 *  what the planner's per-meal/per-day carb targets are measured in. Derived on the
 *  fly so the stored `Nutrition` shape (and its parity fixtures) stays unchanged. */
export function netCarbs(n: Nutrition): number {
  return Math.max(0, n.carb_g - n.fiber_g);
}

/** Net carbs for a recipe, per serving. */
export function recipeNetCarbs(r: Recipe): number {
  return netCarbs(r.nutrition_per_serving);
}

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
