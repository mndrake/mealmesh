import { describe, it, expect } from "vitest";
import type { Recipe, Nutrition, PlanDay } from "../types";
import { netCarbs, recipeNetCarbs, dayTotals } from "../nutrition";

function nut(carb_g: number, fiber_g: number): Nutrition {
  return { kcal: 0, carb_g, fiber_g, protein_g: 0, fat_g: 0 };
}

describe("netCarbs", () => {
  it("subtracts fiber from total carbs", () => {
    expect(netCarbs(nut(20, 5))).toBe(15);
  });

  it("floors at 0 when fiber exceeds carbs (bad/estimated data)", () => {
    expect(netCarbs(nut(3, 8))).toBe(0);
  });

  it("equals total carbs when fiber is 0", () => {
    expect(netCarbs(nut(12, 0))).toBe(12);
  });

  it("recipeNetCarbs reads the per-serving figure", () => {
    const r = { nutrition_per_serving: nut(30, 9) } as Recipe;
    expect(recipeNetCarbs(r)).toBe(21);
  });
});

describe("dayTotals netCarbs", () => {
  function recipe(id: string, n: Nutrition): Recipe {
    return { id, nutrition_per_serving: n, nutrition_estimated: false } as Recipe;
  }

  it("sums each meal's floored net carbs across the day", () => {
    const byId = new Map<string, Recipe>([
      ["b", recipe("b", nut(20, 5))], // 15 net
      ["d", recipe("d", nut(30, 10))], // 20 net
    ]);
    const day: PlanDay = {
      day: "Mon",
      breakfast: { id: "b", leftover: false },
      lunch: null,
      dinner: { id: "d", leftover: false },
      snack: "Small handful of almonds", // string snack contributes nothing
    };
    expect(dayTotals(day, byId).netCarbs).toBe(35);
  });

  it("floors per recipe, so fiber>carbs doesn't subtract from siblings", () => {
    const byId = new Map<string, Recipe>([
      ["a", recipe("a", nut(2, 9))], // floored to 0, not -7
      ["b", recipe("b", nut(10, 0))], // 10 net
    ]);
    const day: PlanDay = {
      day: "Tue",
      breakfast: { id: "a", leftover: false },
      lunch: { id: "b", leftover: false },
      dinner: null,
      snack: null,
    };
    expect(dayTotals(day, byId).netCarbs).toBe(10);
  });
});
