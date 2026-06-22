// Combining/collapsing shopping items: built-in synonyms + manual merges, and the buildList
// aggregation that follows from renaming ingredients to their canonical name.
import { describe, it, expect } from "vitest";
import type { Recipe, Ingredient } from "../types";
import { canonicalName, applyMerges, mergedFrom } from "../listMerge";
import { buildList } from "../shopping";

function ing(partial: Partial<Ingredient>): Ingredient {
  return { qty: 1, unit: "each", item: "x", section: "Dairy & Eggs", perishable: false, staple: false, ...partial };
}
function recipe(id: string, ingredients: Ingredient[]): Recipe {
  return {
    id, title: id, category: "dinner", cuisine: null, servings: 2, prep_style: "cook", tags: [],
    nutrition_per_serving: { kcal: 0, carb_g: 0, fiber_g: 0, protein_g: 0, fat_g: 0 },
    nutrition_estimated: false, imageUrl: null, ingredients, method: "", notes: "", method_is_link_only: false,
  } as Recipe;
}

describe("canonicalName", () => {
  it("folds built-in synonyms", () => {
    expect(canonicalName("whole milk")).toBe("milk");
    expect(canonicalName("hard boiled eggs")).toBe("eggs");
    expect(canonicalName("milk")).toBe("milk");
  });
  it("applies manual merges, and an identity entry opts out of a synonym", () => {
    expect(canonicalName("scallion", { scallion: "green onion" })).toBe("green onion");
    expect(canonicalName("whole milk", { "whole milk": "whole milk" })).toBe("whole milk");
  });
  it("flattens chains and guards against cycles", () => {
    expect(canonicalName("a", { a: "b", b: "c" })).toBe("c");
    expect(canonicalName("a", { a: "b", b: "a" })).toBe("a"); // cycle stops, no infinite loop
  });
});

describe("applyMerges + buildList", () => {
  it("sums quantities of merged items under the canonical name", () => {
    const meals = [
      recipe("a", [ing({ item: "whole milk", unit: "cup", qty: 1 })]),
      recipe("b", [ing({ item: "milk", unit: "cup", qty: 1 })]),
    ];
    const merged = applyMerges(meals, {});
    const list = buildList(merged);
    const dairy = list.sections.find((s) => s.section === "Dairy & Eggs")!;
    expect(dairy.items).toEqual([["milk", "2 cup"]]); // folded + summed, not two lines
  });

  it("manual merge combines two distinct items into one line", () => {
    const meals = [
      recipe("a", [ing({ item: "scallion", unit: "each", qty: 2, section: "Produce" })]),
      recipe("b", [ing({ item: "green onion", unit: "each", qty: 3, section: "Produce" })]),
    ];
    const list = buildList(applyMerges(meals, { scallion: "green onion" }));
    const produce = list.sections.find((s) => s.section === "Produce")!;
    expect(produce.items).toEqual([["green onion", "5 each"]]);
  });
});

describe("mergedFrom", () => {
  it("lists the original names folded into each canonical (pre-merge meals)", () => {
    const meals = [
      recipe("a", [ing({ item: "whole milk", unit: "cup", qty: 1 })]),
      recipe("b", [ing({ item: "milk", unit: "cup", qty: 1 })]),
    ];
    const m = mergedFrom(meals, {});
    expect(m.get("milk")).toEqual(["whole milk"]); // "milk" itself excluded
  });
});
