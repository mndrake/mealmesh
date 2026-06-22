import { describe, it, expect } from "vitest";
import {
  generationUserPrompt,
  toGeneratedDraft,
  validateGenerated,
  netCarbsOf,
  isPantryStaple,
  type GenConstraints,
  type GeneratedRecipe,
} from "./recipe-generate";

const C: GenConstraints = {
  count: 3,
  role: "lunch",
  maxIngredients: 5,
  maxNetCarbs: 12,
  palette: ["chicken breast", "romaine"],
  noFish: true,
  servings: 2,
};

function gen(over: Partial<GeneratedRecipe> = {}): GeneratedRecipe {
  return {
    title: "Chicken Romaine Bowl",
    cuisine: null,
    servings: 2,
    prep_minutes: 10,
    cook_minutes: 0,
    prep_style: "no_cook",
    office_friendly: true,
    batch: false,
    ingredients: [
      { qty: 6, unit: "oz", item: "chicken breast", section: "Meat & Poultry", note: "cooked, cubed" },
      { qty: 2, unit: "cup", item: "romaine", section: "Produce", note: "chopped" },
      { qty: 1, unit: "tbsp", item: "olive oil", section: "Condiments & Spices", note: "" },
      { qty: 1, unit: "pinch", item: "salt", section: "Condiments & Spices", note: "" },
    ],
    method: "1. Toss everything together.",
    notes: "",
    nutrition: { kcal: 320, carb_g: 8, fiber_g: 3, protein_g: 38, fat_g: 16 },
    ...over,
  };
}

describe("generationUserPrompt", () => {
  it("injects count, role, ceilings, palette, and the no-fish rule", () => {
    const p = generationUserPrompt(C);
    expect(p).toContain("3 different lunch recipes");
    expect(p).toContain("2 people");
    expect(p).toContain("5 shoppable ingredients");
    expect(p).toContain("12g net carbs");
    expect(p).toContain("chicken breast, romaine");
    expect(p).toMatch(/No fish/i);
  });
});

describe("toGeneratedDraft", () => {
  const d = toGeneratedDraft(gen(), C, () => "u-fixed");

  it("produces a stored-ready draft with planner fields and a generated mark", () => {
    expect(d.id).toBe("u-fixed");
    expect(d.category).toBe("lunch"); // from the role
    expect(d.prep_style).toBe("no_cook");
    expect(d.office_friendly).toBe(true);
    expect(d.batch).toBe(false);
    expect(d.tags).toContain("generated");
    expect(d.tags).toContain("diabetic-friendly");
    expect(d.tags).toContain("low-carb"); // net carbs (8-3=5) <= 20
    expect(d.nutrition_estimated).toBe(true);
    expect(d.method_is_link_only).toBe(false);
  });

  it("flags pantry staples so they don't inflate the shopping palette", () => {
    const oil = d.ingredients.find((i) => i.item === "olive oil")!;
    const salt = d.ingredients.find((i) => i.item === "salt")!;
    const chicken = d.ingredients.find((i) => i.item === "chicken breast")!;
    expect(oil.staple).toBe(true);
    expect(salt.staple).toBe(true);
    expect(chicken.staple).toBe(false);
  });
});

describe("validateGenerated", () => {
  it("passes a simple, low-net-carb, fish-free recipe", () => {
    const d = toGeneratedDraft(gen(), C);
    expect(validateGenerated(d, C)).toEqual([]);
  });

  it("flags too many shoppable ingredients (staples excluded)", () => {
    const big = gen({
      ingredients: [
        { qty: 1, unit: "each", item: "chicken breast", section: "Meat & Poultry", note: "" },
        { qty: 1, unit: "each", item: "romaine", section: "Produce", note: "" },
        { qty: 1, unit: "each", item: "cucumber", section: "Produce", note: "" },
        { qty: 1, unit: "each", item: "tomato", section: "Produce", note: "" },
        { qty: 1, unit: "each", item: "feta", section: "Dairy & Eggs", note: "" },
        { qty: 1, unit: "each", item: "olives", section: "Pantry & Dry Goods", note: "" },
        { qty: 1, unit: "pinch", item: "salt", section: "Condiments & Spices", note: "" }, // staple, ignored
      ],
    });
    const reasons = validateGenerated(toGeneratedDraft(big, C), C);
    expect(reasons.some((r) => /6 shoppable ingredients/.test(r))).toBe(true);
  });

  it("flags net carbs over the target", () => {
    const carby = gen({ nutrition: { kcal: 400, carb_g: 40, fiber_g: 2, protein_g: 20, fat_g: 10 } });
    const reasons = validateGenerated(toGeneratedDraft(carby, C), C);
    expect(reasons.some((r) => /net carbs/.test(r))).toBe(true);
  });

  it("flags fish when noFish is set", () => {
    const fishy = gen({
      ingredients: [
        { qty: 6, unit: "oz", item: "salmon fillet", section: "Meat & Poultry", note: "" },
        { qty: 2, unit: "cup", item: "romaine", section: "Produce", note: "" },
      ],
    });
    const reasons = validateGenerated(toGeneratedDraft(fishy, C), C);
    expect(reasons).toContain("contains fish");
  });
});

describe("helpers", () => {
  it("netCarbsOf floors at 0", () => {
    expect(netCarbsOf({ kcal: 0, carb_g: 3, fiber_g: 9, protein_g: 0, fat_g: 0 })).toBe(0);
    expect(netCarbsOf({ kcal: 0, carb_g: 20, fiber_g: 5, protein_g: 0, fat_g: 0 })).toBe(15);
  });

  it("isPantryStaple recognizes common staples but not real ingredients", () => {
    expect(isPantryStaple("olive oil")).toBe(true);
    expect(isPantryStaple("kosher salt")).toBe(true);
    expect(isPantryStaple("chicken breast")).toBe(false);
    expect(isPantryStaple("blueberries")).toBe(false);
  });
});
