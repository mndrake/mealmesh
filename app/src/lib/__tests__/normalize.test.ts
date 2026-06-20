import { describe, it, expect } from "vitest";
import type { Ingredient, Recipe } from "../types";
import {
  normalizeIngredientForDisplay,
  normalizeIngredientForShopping,
  normalizeForShopping,
} from "../normalize";
import { buildList } from "../shopping";

const ing = (over: Partial<Ingredient>): Ingredient => ({
  qty: 1,
  unit: "each",
  item: "thing",
  section: "Produce",
  perishable: false,
  staple: false,
  ...over,
});

const recipe = (ingredients: Ingredient[]): Recipe =>
  ({ id: "r", title: "R", ingredients } as unknown as Recipe);

describe("normalize: mislabeled names", () => {
  it("renames 'starch' to cornstarch and moves it to Pantry (display + shopping)", () => {
    const raw = ing({ item: "starch", unit: "tbsp", section: "Produce" });
    expect(normalizeIngredientForDisplay(raw)).toMatchObject({
      item: "cornstarch",
      section: "Pantry & Dry Goods",
    });
    expect(normalizeIngredientForShopping(raw)).toMatchObject({
      item: "cornstarch",
      section: "Pantry & Dry Goods",
    });
  });
});

describe("normalize: store sections", () => {
  it("moves shallot out of Meat & Poultry into Produce", () => {
    const raw = ing({ item: "minced shallot", unit: "tbsp", section: "Meat & Poultry" });
    expect(normalizeIngredientForDisplay(raw).section).toBe("Produce");
  });

  it("routes frozen produce to the Frozen section", () => {
    const raw = ing({ item: "strawberries, frozen", unit: "cup", section: "Produce" });
    expect(normalizeIngredientForDisplay(raw).section).toBe("Frozen");
  });
});

describe("normalize: chopped veg -> approximate whole (shopping only)", () => {
  it("keeps prep wording for display", () => {
    const raw = ing({ item: "chopped red bell pepper", qty: 2, unit: "cup", section: "Produce" });
    const disp = normalizeIngredientForDisplay(raw);
    expect(disp.item).toBe("chopped red bell pepper");
    expect(disp.unit).toBe("cup");
  });

  it("collapses to whole 'each' of the base item for shopping", () => {
    const raw = ing({ item: "chopped red bell pepper", qty: 2, unit: "cup", section: "Produce" });
    const shop = normalizeIngredientForShopping(raw);
    expect(shop.item).toBe("red bell pepper");
    expect(shop.unit).toBe("each");
    expect(shop.qty).toBe(2);
  });

  it("merges 'chopped red bell pepper' and 'red bell pepper' into one shopping line", () => {
    const meals = [
      recipe([ing({ item: "chopped red bell pepper", qty: 1, unit: "cup", section: "Produce" })]),
      recipe([ing({ item: "red bell pepper", qty: 2, unit: "each", section: "Produce" })]),
    ];
    const list = buildList(normalizeForShopping(meals));
    const produce = list.sections.find((s) => s.section === "Produce")!;
    const peppers = produce.items.filter(([name]) => name === "red bell pepper");
    expect(peppers).toHaveLength(1);
    expect(peppers[0][1]).toBe("3 each");
  });

  it("uses a higher factor for small shallots", () => {
    const raw = ing({ item: "finely chopped shallot", qty: 1, unit: "cup", section: "Meat & Poultry" });
    const shop = normalizeIngredientForShopping(raw);
    expect(shop.item).toBe("shallots");
    expect(shop.qty).toBe(3);
    expect(shop.unit).toBe("each");
  });

  it("merges herb name without forcing a whole count", () => {
    const raw = ing({ item: "chopped fresh parsley", qty: 2, unit: "tbsp", section: "Condiments & Spices" });
    const shop = normalizeIngredientForShopping(raw);
    expect(shop.item).toBe("fresh parsley");
    expect(shop.unit).toBe("tbsp"); // not converted
    expect(shop.section).toBe("Produce");
  });
});

describe("normalize: widened audit (Produce/Pantry/Condiments)", () => {
  it.each([
    ["gruyère", "Condiments & Spices" as const, "Dairy & Eggs"],
    ["chuck roast", "Produce" as const, "Meat & Poultry"],
    ["ciabatta", "Produce" as const, "Bakery"],
    ["spaghetti", "Produce" as const, "Pantry & Dry Goods"],
    ["gochujang", "Produce" as const, "Condiments & Spices"],
    ["basil", "Condiments & Spices" as const, "Produce"], // fresh herb out of spices
    ["green pepper", "Condiments & Spices" as const, "Produce"], // fresh pepper out of spices
    ["bean sprouts", "Pantry & Dry Goods" as const, "Produce"],
    ["cocoa powder", "Condiments & Spices" as const, "Pantry & Dry Goods"],
    ["chicken broth", "Meat & Poultry" as const, "Canned Goods (Soups, vegetables, and pasta sauces, etc.)"],
  ])("re-sections %s -> %s", (item, from, to) => {
    expect(normalizeIngredientForDisplay(ing({ item, section: from })).section).toBe(to);
  });

  it("keeps the dried-vs-fresh distinction (dried herbs stay in spices)", () => {
    // "dried basil" has no override; only bare "basil" moves to Produce.
    const driedBasil = ing({ item: "dried basil", section: "Condiments & Spices" });
    expect(normalizeIngredientForDisplay(driedBasil).section).toBe("Condiments & Spices");
  });

  it("fixes the 'challots' typo to shallots in Produce", () => {
    expect(normalizeIngredientForDisplay(ing({ item: "challots", section: "Produce" }))).toMatchObject({
      item: "shallots",
      section: "Produce",
    });
  });

  it.each([
    "canned chickpeas",
    "kidney beans",
    "diced tomatoes",
    "marinara sauce",
    "chicken broth",
    "coconut milk",
    "whole beets",
  ])("routes canned item %s to Canned Goods", (item) => {
    expect(normalizeIngredientForDisplay(ing({ item, section: "Produce" })).section).toBe(
      "Canned Goods (Soups, vegetables, and pasta sauces, etc.)"
    );
  });

  it("leaves dried staples in Pantry (not Canned Goods)", () => {
    for (const item of ["dried lentils", "lentils", "dried split peas", "toor dal"]) {
      // no override -> section unchanged
      expect(normalizeIngredientForDisplay(ing({ item, section: "Pantry & Dry Goods" })).section).toBe(
        "Pantry & Dry Goods"
      );
    }
  });

  it("drops non-grocery water/ice from the shopping list", () => {
    const meals = [
      recipe([
        ing({ item: "water", qty: 2, unit: "cup", section: "Condiments & Spices" }),
        ing({ item: "ice cubes", qty: 1, unit: "cup", section: "Condiments & Spices" }),
        ing({ item: "lemon", qty: 1, unit: "each", section: "Produce" }),
      ]),
    ];
    const list = buildList(normalizeForShopping(meals));
    const allNames = list.sections.flatMap((s) => s.items.map(([n]) => n));
    expect(allNames).toContain("lemon");
    expect(allNames).not.toContain("water");
    expect(allNames).not.toContain("ice cubes");
  });
});
