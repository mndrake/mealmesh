import { describe, it, expect } from "vitest";
import type { Recipe, Nutrition } from "../types";
import { applyFilters, emptyFilters } from "../filters";

function recipe(id: string, n: Nutrition): Recipe {
  return {
    id,
    title: id,
    category: "dinner",
    cuisine: null,
    servings: 2,
    prep_style: "cook",
    tags: [],
    nutrition_per_serving: n,
    nutrition_estimated: false,
    imageUrl: null,
    ingredients: [],
    method: "",
    notes: "",
    method_is_link_only: false,
  } as Recipe;
}

const nut = (carb_g: number, fiber_g: number): Nutrition => ({
  kcal: 0,
  carb_g,
  fiber_g,
  protein_g: 0,
  fat_g: 0,
});

describe("applyFilters maxNetCarbs", () => {
  // 30g carb − 12g fiber = 18g net; 20g carb − 2g fiber = 18g net (same net, different total)
  const fiberRich = recipe("fiber-rich", nut(30, 12));
  const lowFiber = recipe("low-fiber", nut(20, 2));
  const all = [fiberRich, lowFiber];
  const noFavs = new Set<string>();

  it("keeps a high-total but high-fiber recipe that a carb filter would reject", () => {
    const out = applyFilters(all, { ...emptyFilters(), maxNetCarbs: 18 }, noFavs);
    expect(out.map((r) => r.id).sort()).toEqual(["fiber-rich", "low-fiber"]);
  });

  it("excludes recipes whose net carbs exceed the cap", () => {
    const out = applyFilters(all, { ...emptyFilters(), maxNetCarbs: 10 }, noFavs);
    expect(out).toHaveLength(0);
  });

  it("is independent of the total-carb filter", () => {
    // maxCarbs:25 drops the 30g recipe; maxNetCarbs alone keeps it
    const byTotal = applyFilters(all, { ...emptyFilters(), maxCarbs: 25 }, noFavs);
    expect(byTotal.map((r) => r.id)).toEqual(["low-fiber"]);
    const byNet = applyFilters(all, { ...emptyFilters(), maxNetCarbs: 25 }, noFavs);
    expect(byNet.map((r) => r.id).sort()).toEqual(["fiber-rich", "low-fiber"]);
  });
});
