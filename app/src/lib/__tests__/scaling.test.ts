import { describe, it, expect } from "vitest";
import type { Plan, Recipe, Ingredient, MealRef } from "../types";
import { scaleRecipe, coverageByRecipe, scaledShoppingMeals } from "../scaling";

function ing(item: string, qty: number | null): Ingredient {
  return { qty, unit: "oz", item, section: "Produce", perishable: true, staple: false };
}

function recipe(id: string, servings: number, ings: Ingredient[]): Recipe {
  return {
    id,
    title: id,
    category: "dinner",
    cuisine: null,
    servings,
    prep_style: "cook",
    tags: [],
    nutrition_per_serving: { kcal: 0, carb_g: 0, fiber_g: 0, protein_g: 0, fat_g: 0 },
    nutrition_estimated: false,
    imageUrl: null,
    ingredients: ings,
    method: "",
    notes: "",
    method_is_link_only: false,
  } as Recipe;
}

const ref = (id: string, leftover = false): MealRef => ({ id, leftover });

describe("scaleRecipe", () => {
  it("multiplies numeric quantities and leaves null ('to taste') alone", () => {
    const r = recipe("r", 4, [ing("chicken", 16), ing("salt", null)]);
    const s = scaleRecipe(r, 0.5);
    expect(s.ingredients[0].qty).toBe(8);
    expect(s.ingredients[1].qty).toBeNull();
    expect(r.ingredients[0].qty).toBe(16); // original untouched
  });
});

describe("coverageByRecipe", () => {
  it("counts every day-slot a recipe occupies (cooked + leftover)", () => {
    const plan: Plan = [
      { day: "Mon", breakfast: ref("egg"), lunch: null, dinner: ref("d1"), snack: null },
      { day: "Tue", breakfast: ref("egg", true), lunch: null, dinner: ref("d1", true), snack: null },
      { day: "Wed", breakfast: ref("egg", true), lunch: null, dinner: null, snack: "Almonds" },
    ];
    const cov = coverageByRecipe(plan);
    expect(cov.get("egg")).toBe(3);
    expect(cov.get("d1")).toBe(2);
  });
});

describe("scaledShoppingMeals", () => {
  const byId = new Map<string, Recipe>([
    ["egg", recipe("egg", 4, [ing("eggs", 8)])], // 4-serving batch
    ["d1", recipe("d1", 2, [ing("beef", 12)])], // 2-serving dinner
  ]);

  it("scales a batch breakfast by coverage × household, fixing the leftover under-count", () => {
    // egg bake cooked Mon, eaten Mon–Fri (coverage 5), 2 people -> 10 portions / 4 servings = 2.5x
    const plan: Plan = [0, 1, 2, 3, 4].map((i) => ({
      day: `D${i}`,
      breakfast: ref("egg", i > 0),
      lunch: null,
      dinner: null,
      snack: null,
    }));
    const meals = scaledShoppingMeals(plan, byId, 2);
    expect(meals).toHaveLength(1); // one cooked copy, leftovers folded in
    expect(meals[0].ingredients[0].qty).toBe(20); // 8 eggs × (10/4) = 20
  });

  it("scales a single fresh dinner to exactly the household size", () => {
    const plan: Plan = [
      { day: "Mon", breakfast: null, lunch: null, dinner: ref("d1"), snack: null },
    ];
    // 1 day × 2 people = 2 portions / 2 servings = 1x → unchanged
    expect(scaledShoppingMeals(plan, byId, 2)[0].ingredients[0].qty).toBe(12);
    // 4 people → 2x
    expect(scaledShoppingMeals(plan, byId, 4)[0].ingredients[0].qty).toBe(24);
  });

  it("emits nothing for an unknown recipe id", () => {
    const plan: Plan = [
      { day: "Mon", breakfast: ref("missing"), lunch: null, dinner: null, snack: null },
    ];
    expect(scaledShoppingMeals(plan, byId, 2)).toEqual([]);
  });
});
