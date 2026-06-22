import { describe, it, expect } from "vitest";
import type { Plan, PlanDay, Recipe, MealRef } from "../types";
import { prepPlan } from "../prep";

function r(id: string, title: string): Recipe {
  return { id, title } as Recipe;
}

const ref = (id: string, leftover = false): MealRef => ({ id, leftover });

function day(d: string, b: string | null, l: string | null, din: string | null): PlanDay {
  return {
    day: d,
    breakfast: b ? ref(b, d !== "Mon") : null,
    lunch: l ? ref(l, d !== "Mon") : null,
    dinner: din ? ref(din) : null,
    snack: null,
  };
}

describe("prepPlan", () => {
  const byId = new Map<string, Recipe>([
    ["egg", r("egg", "Egg Bake")],
    ["salad", r("salad", "Chicken Salad")],
    ["d1", r("d1", "Shrimp Stir-fry")],
    ["d2", r("d2", "Beef Burgers")],
  ]);

  // One egg bake all week (breakfast), one salad all week (lunch), two fresh dinners.
  const plan: Plan = [
    day("Mon", "egg", "salad", "d1"),
    day("Tue", "egg", "salad", "d2"),
    day("Wed", "egg", "salad", null),
  ];

  it("flags batch-cooked recipes (used 2+ day-slots) as prep-ahead, most-covered first", () => {
    const p = prepPlan(plan, byId);
    expect(p.prepAhead.map((x) => x.recipeId)).toEqual(["egg", "salad"]);
    expect(p.prepAhead[0]).toMatchObject({ days: 3, slots: ["breakfast"] });
    expect(p.prepAhead[1]).toMatchObject({ days: 3, slots: ["lunch"] });
  });

  it("lists once-used recipes as fresh, in plan order", () => {
    const p = prepPlan(plan, byId);
    expect(p.fresh.map((f) => f.recipeId)).toEqual(["d1", "d2"]);
    expect(p.fresh[0]).toMatchObject({ day: "Mon", slot: "dinner", title: "Shrimp Stir-fry" });
  });

  it("ignores canned snack strings and unknown ids", () => {
    const plan2: Plan = [
      { day: "Mon", breakfast: ref("egg"), lunch: null, dinner: null, snack: "Almonds" },
      { day: "Tue", breakfast: ref("egg", true), lunch: null, dinner: ref("missing"), snack: null },
    ];
    const p = prepPlan(plan2, byId);
    expect(p.prepAhead.map((x) => x.recipeId)).toEqual(["egg"]);
    expect(p.fresh).toHaveLength(0); // egg is prep-ahead; "missing" id is skipped
  });
});
