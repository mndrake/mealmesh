// Port of recipe-repo/build/planner.py — assemble a 7-day plan honoring
// constraints and maximizing shared perishable ingredients. Deterministic;
// asserted against a golden fixture. The greedy picker relies on the recipe
// array being in sorted-path order (see recipes.ts) and on first-max-wins ties.
import type { Recipe, Plan, PlanDay, MealRef } from "./types";

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY = new Set(DAYS.slice(0, 5));
export const SNACKS = [
  "Apple + 1 tbsp almond butter",
  "Veggie sticks + hummus",
  "Greek yogurt + berries",
  "Cheese stick + cherry tomatoes",
  "Small handful of almonds",
];

function perishables(r: Recipe): Set<string> {
  const s = new Set<string>();
  for (const i of r.ingredients) {
    if (i.perishable) s.add(i.buy_as || i.item);
  }
  return s;
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/**
 * Greedy: cover the whole pool before repeating, and among equally-used options
 * prefer the one that shares the most perishable ingredients. Returns the first
 * element at the max score, exactly like Python's `max(pool, key=score)`.
 */
function pickSequence(pool: Recipe[], n: number, seedSet?: Set<string>): Recipe[] {
  const chosen: Recipe[] = [];
  const pantry = new Set<string>(seedSet ?? []);
  const used = new Map<string, number>(pool.map((r) => [r.id, 0]));
  const lastUsed = new Map<string, number>();

  for (let slot = 0; slot < n; slot++) {
    const score = (r: Recipe): number => {
      const overlap = intersectionSize(perishables(r), pantry);
      const recency = slot - (lastUsed.get(r.id) ?? -99);
      const recentPenalty = recency < 3 ? 3 : 0;
      return -(used.get(r.id) ?? 0) * 100 + overlap * 2 - recentPenalty;
    };
    let best = pool[0];
    let bestScore = score(pool[0]);
    for (let i = 1; i < pool.length; i++) {
      const s = score(pool[i]);
      if (s > bestScore) {
        bestScore = s;
        best = pool[i];
      }
    }
    chosen.push(best);
    for (const p of perishables(best)) pantry.add(p);
    used.set(best.id, (used.get(best.id) ?? 0) + 1);
    lastUsed.set(best.id, slot);
  }
  return chosen;
}

export interface PlanOptions {
  /** Tags every chosen recipe must have. Python default: ["diabetic-friendly"].
   *  The app passes [] so the whole library is eligible. */
  requireTags?: string[];
  excludeTags?: string[];
}

/** Build a 7-day plan from the recipe pool. Mirrors planner.build_plan. */
export function buildPlan(recipes: Recipe[], opts: PlanOptions = {}): Plan {
  const requireTags = opts.requireTags ?? ["diabetic-friendly"];
  const excludeTags = opts.excludeTags ?? ["no-fish-violation"];

  const ok = (r: Recipe): boolean => {
    const t = new Set(r.tags);
    return (
      requireTags.every((x) => t.has(x)) && !excludeTags.some((x) => t.has(x))
    );
  };
  const pool = recipes.filter(ok);
  const bf = pool.filter((r) => r.category === "breakfast");
  const lun = pool.filter((r) => r.category === "lunch");
  const din = pool.filter((r) => r.category === "dinner");

  const bfWeekday = bf.filter(
    (r) => r.prep_style === "no_cook" || r.prep_style === "make_ahead"
  );
  const bfWeekendCook = bf.filter((r) => r.prep_style === "cook");
  const bfWeekend = bfWeekendCook.length ? bfWeekendCook : bf;
  const lunOffice = lun.filter((r) => r.office_friendly && r.prep_style === "no_cook");
  const batchDin = din.filter((r) => r.batch);

  // dinners: schedule batch dinners early (Tue/Fri) so leftovers feed weekend lunches
  const otherDin = din.filter((r) => !r.batch);
  const dinnerSeq = pickSequence(otherDin, 7);
  const placedBatch: [number, Recipe][] = [];
  [1, 4].forEach((slot, k) => {
    if (k < batchDin.length) {
      dinnerSeq[slot] = batchDin[k];
      placedBatch.push([slot, batchDin[k]]);
    }
  });

  const bfWdSeq = pickSequence(bfWeekday, 5);
  const bfWeSeq = pickSequence(bfWeekend, 2);
  const lunSeq = pickSequence(lunOffice, 5);

  const plan: Plan = [];
  DAYS.forEach((day, di) => {
    const meal = (id: string, leftover: boolean): MealRef => ({ id, leftover });
    const d: PlanDay = {
      day,
      breakfast: null,
      lunch: null,
      dinner: null,
      snack: SNACKS[di % SNACKS.length],
    };
    if (WEEKDAY.has(day)) {
      d.breakfast = meal(bfWdSeq[di].id, false);
      d.lunch = meal(lunSeq[di].id, false);
    } else {
      const we = di - 5;
      d.breakfast = meal(bfWeSeq[we].id, false);
      // weekend lunch = leftover from a batch dinner cooked earlier
      const src = placedBatch.length
        ? placedBatch[we % placedBatch.length][1]
        : lun[we];
      d.lunch = meal(src.id, placedBatch.length > 0);
    }
    d.dinner = meal(dinnerSeq[di].id, false);
    plan.push(d);
  });
  return plan;
}

/** Rebuild a plan while keeping locked slots from the current plan.
 *  `lockedKeys` are "<dayIndex>:<slot>" strings. Locked recipe ids are removed from
 *  the build pool so a regenerate can never duplicate a meal you pinned. Snack
 *  strings carry no id and are preserved purely by the overlay. */
export function regeneratePlan(
  recipes: Recipe[],
  current: Plan,
  lockedKeys: Set<string>,
  opts: PlanOptions = {}
): Plan {
  const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
  const lockedIds = new Set<string>();
  current.forEach((day, di) => {
    for (const slot of SLOTS) {
      if (!lockedKeys.has(`${di}:${slot}`)) continue;
      const ref = day[slot];
      if (ref && typeof ref !== "string") lockedIds.add(ref.id);
    }
  });

  const fresh = buildPlan(
    recipes.filter((r) => !lockedIds.has(r.id)),
    opts
  );

  const keep = (di: number, slot: (typeof SLOTS)[number]) =>
    lockedKeys.has(`${di}:${slot}`);
  return fresh.map(
    (day, di): PlanDay => ({
      day: day.day,
      breakfast: keep(di, "breakfast") ? current[di].breakfast : day.breakfast,
      lunch: keep(di, "lunch") ? current[di].lunch : day.lunch,
      dinner: keep(di, "dinner") ? current[di].dinner : day.dinner,
      snack: keep(di, "snack") ? current[di].snack : day.snack,
    })
  );
}

/** Recipes actually cooked/assembled (leftovers excluded) -> for the shopping list.
 *  Snack slots are included so a recipe placed there is shopped for, consistent with
 *  the nutrition totals. Canned snack *strings* (from auto-suggest) carry no recipe and
 *  are skipped — so this stays identical to planner.py:cooked_meals for generated plans. */
export function cookedMeals(plan: Plan, byId: Map<string, Recipe>): Recipe[] {
  const meals: Recipe[] = [];
  for (const day of plan) {
    for (const slot of ["breakfast", "lunch", "dinner", "snack"] as const) {
      const ref = day[slot];
      if (ref && typeof ref !== "string" && !ref.leftover) {
        const r = byId.get(ref.id);
        if (r) meals.push(r);
      }
    }
  }
  return meals;
}
