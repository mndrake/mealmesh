import { describe, it, expect } from "vitest";
import type { Recipe, Ingredient } from "../types";
import { rawRecipes, rawRecipesById } from "../recipes";
import { planEase, recipeComplexity, shoppableItems } from "../ease";
import { buildPlan, cookedMeals } from "../planner";

function ing(item: string, extra: Partial<Ingredient> = {}): Ingredient {
  return { qty: 1, unit: "each", item, section: "Produce", perishable: true, staple: false, ...extra };
}

function recipe(id: string, ingredients: Ingredient[]): Recipe {
  return {
    id,
    title: id,
    category: "dinner",
    cuisine: null,
    servings: 2,
    prep_style: "cook",
    tags: [],
    nutrition_per_serving: { kcal: 0, carb_g: 0, fiber_g: 0, protein_g: 0, fat_g: 0 },
    nutrition_estimated: false,
    imageUrl: null,
    ingredients,
    method: "",
    notes: "",
    method_is_link_only: false,
  } as Recipe;
}

describe("ease metrics", () => {
  it("counts distinct shoppable items, excluding staples and excluded items", () => {
    const r = recipe("r", [
      ing("chicken"),
      ing("olive oil", { staple: true }), // owned staple — not part of the buy
      ing("water", { exclude_from_shopping: true }),
      ing("extra virgin olive oil", { buy_as: "olive oil" }), // keyed by buy_as
    ]);
    expect(shoppableItems(r)).toEqual(new Set(["chicken", "olive oil"]));
    expect(recipeComplexity(r)).toBe(2);
  });

  it("planEase measures palette size and reuse across meals", () => {
    const a = recipe("a", [ing("chicken"), ing("rice"), ing("broccoli")]);
    const b = recipe("b", [ing("chicken"), ing("rice"), ing("peppers")]); // reuses chicken+rice
    const e = planEase([a, b]);
    expect(e.paletteSize).toBe(4); // chicken, rice, broccoli, peppers
    expect(e.totalUses).toBe(6);
    expect(e.meals).toBe(2);
    expect(e.avgPerMeal).toBe(3);
    expect(e.reuse).toBeCloseTo(1.5); // 6 uses / 4 distinct
  });

  it("empty plan is well-defined", () => {
    expect(planEase([])).toMatchObject({ paletteSize: 0, totalUses: 0, meals: 0, reuse: 0 });
  });
});

describe("minimizeIngredients planner mode", () => {
  it("produces a smaller shopping palette than the default plan on the real dataset", () => {
    const baseline = cookedMeals(buildPlan(rawRecipes), rawRecipesById);
    const easy = cookedMeals(
      buildPlan(rawRecipes, { minimizeIngredients: true }),
      rawRecipesById
    );
    const basePalette = planEase(baseline).paletteSize;
    const easyPalette = planEase(easy).paletteSize;
    // The ease picker should buy strictly fewer distinct ingredients for the week.
    expect(easyPalette).toBeLessThan(basePalette);
  });

  it("still fills a complete 7-day plan", () => {
    const plan = buildPlan(rawRecipes, { minimizeIngredients: true });
    expect(plan).toHaveLength(7);
    for (const d of plan) {
      expect(d.breakfast).not.toBeNull();
      expect(d.lunch).not.toBeNull();
      expect(d.dinner).not.toBeNull();
    }
  });

  it("batch-cooks one weekday breakfast and one weekday lunch (cooked Mon, leftover Tue–Fri)", () => {
    const plan = buildPlan(rawRecipes, { minimizeIngredients: true });
    const ref = (x: unknown) => x as { id: string; leftover: boolean };
    const bfIds = [0, 1, 2, 3, 4].map((di) => ref(plan[di].breakfast).id);
    const lunIds = [0, 1, 2, 3, 4].map((di) => ref(plan[di].lunch).id);
    // same recipe all five weekdays
    expect(new Set(bfIds).size).toBe(1);
    expect(new Set(lunIds).size).toBe(1);
    // cooked once on Monday, leftovers the rest of the week
    expect(ref(plan[0].breakfast).leftover).toBe(false);
    expect(ref(plan[4].breakfast).leftover).toBe(true);
    expect(ref(plan[0].lunch).leftover).toBe(false);
    expect(ref(plan[4].lunch).leftover).toBe(true);
  });
});
