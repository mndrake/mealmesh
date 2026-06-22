import { describe, it, expect } from "vitest";
import type { Recipe, Nutrition } from "../types";
import { netCarbs, recipeNetCarbs } from "../nutrition";

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
