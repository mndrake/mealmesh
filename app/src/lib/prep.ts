// Derive a "weekend prep" blueprint from a plan — the make-once-eat-many view that
// makes a menu easy to cook (cf. the Gemini sample's Sunday batch-cooking blueprint).
// A recipe used on 2+ day-slots is something you batch-cook once on prep day; recipes
// used once are cooked fresh that day. Purely derived from the plan, no extra data.
import type { Plan, Recipe } from "./types";

type Slot = "breakfast" | "lunch" | "dinner" | "snack";
const SLOTS: Slot[] = ["breakfast", "lunch", "dinner", "snack"];

export interface PrepItem {
  recipeId: string;
  title: string;
  /** How many day-slots this recipe covers across the week. */
  days: number;
  /** Which meal slots it fills (e.g. ["breakfast"]). */
  slots: Slot[];
}

export interface FreshMeal {
  day: string;
  slot: Slot;
  recipeId: string;
  title: string;
}

export interface PrepPlan {
  /** Batch-cook once, reuse all week (used on 2+ day-slots). Most-covered first. */
  prepAhead: PrepItem[];
  /** Cooked fresh on the day (used once). In plan order. */
  fresh: FreshMeal[];
}

export function prepPlan(plan: Plan, byId: Map<string, Recipe>): PrepPlan {
  // recipeId -> occurrences across the week, with the slots it appears in.
  const agg = new Map<string, { title: string; days: number; slots: Set<Slot> }>();
  const order: { day: string; slot: Slot; recipeId: string }[] = [];

  for (const day of plan) {
    for (const slot of SLOTS) {
      const ref = day[slot];
      if (!ref || typeof ref === "string") continue; // skip canned snack strings
      const r = byId.get(ref.id);
      if (!r) continue;
      order.push({ day: day.day, slot, recipeId: ref.id });
      let a = agg.get(ref.id);
      if (!a) agg.set(ref.id, (a = { title: r.title, days: 0, slots: new Set() }));
      a.days++;
      a.slots.add(slot);
    }
  }

  const prepAhead: PrepItem[] = [];
  for (const [recipeId, a] of agg) {
    if (a.days >= 2) {
      prepAhead.push({ recipeId, title: a.title, days: a.days, slots: [...a.slots] });
    }
  }
  // Most-covered first; stable by recipeId for determinism on ties.
  prepAhead.sort((x, y) => y.days - x.days || x.recipeId.localeCompare(y.recipeId));

  const fresh: FreshMeal[] = order
    .filter(({ recipeId }) => (agg.get(recipeId)?.days ?? 0) < 2)
    .map(({ day, slot, recipeId }) => ({
      day,
      slot,
      recipeId,
      title: agg.get(recipeId)!.title,
    }));

  return { prepAhead, fresh };
}
