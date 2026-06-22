// Monthly plan: instead of 30 distinct days, a rotating template of two designed
// weeks (Weeks 1 & 3 and Weeks 2 & 4) — the sustainable structure from the Gemini
// sample. Each week is an ease-mode weekly plan (small reused palette, one
// batch-cooked breakfast + lunch, fresh dinners); the second week is built to avoid
// the first's recipes so the rotation has variety. Everything else (prep blueprint,
// shopping list, net-carb totals) is derived from these two plans with the existing
// pure helpers, so this module stays thin.
import type { Plan, Recipe } from "./types";
import { buildPlan, type PlanOptions } from "./planner";

export interface MonthlyWeek {
  /** e.g. "Weeks 1 & 3". */
  label: string;
  /** Calendar weeks this menu covers. */
  weeks: number[];
  plan: Plan;
}

export interface MonthlyPlan {
  householdSize: number;
  /** Per-day net-carb ceiling the days are checked against. */
  netCarbTargetPerDay: number;
  weeks: MonthlyWeek[];
}

export interface MonthlyOptions extends PlanOptions {
  householdSize?: number;
  netCarbTargetPerDay?: number;
}

/** Every recipe id referenced by a plan (cooked or leftover), ignoring snack strings. */
export function collectPlanRecipeIds(plan: Plan): Set<string> {
  const ids = new Set<string>();
  for (const day of plan) {
    for (const slot of ["breakfast", "lunch", "dinner", "snack"] as const) {
      const ref = day[slot];
      if (ref && typeof ref !== "string") ids.add(ref.id);
    }
  }
  return ids;
}

/** Build a two-week rotational monthly plan. Both weeks use ease mode; the second
 *  avoids the first's recipes (where the pools allow) for variety. */
export function buildMonthlyPlan(
  recipes: Recipe[],
  opts: MonthlyOptions = {}
): MonthlyPlan {
  const {
    householdSize = 2,
    netCarbTargetPerDay = 100,
    ...planOpts
  } = opts;
  const base: PlanOptions = { ...planOpts, minimizeIngredients: true };

  const planA = buildPlan(recipes, base);
  const usedA = collectPlanRecipeIds(planA);
  const planB = buildPlan(recipes, { ...base, excludeIds: usedA });

  return {
    householdSize,
    netCarbTargetPerDay,
    weeks: [
      { label: "Weeks 1 & 3", weeks: [1, 3], plan: planA },
      { label: "Weeks 2 & 4", weeks: [2, 4], plan: planB },
    ],
  };
}
