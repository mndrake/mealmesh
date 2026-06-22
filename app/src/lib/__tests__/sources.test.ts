// buildSources: maps each shopping item (same buy_as||item key buildList uses) to the
// recipe(s) that call for it, with each recipe's own wording (variety + prep).
import { describe, it, expect } from "vitest";
import type { Recipe, Ingredient } from "../types";
import { buildSources } from "../shopping";

function ing(partial: Partial<Ingredient>): Ingredient {
  return {
    qty: 1,
    unit: "each",
    item: "x",
    section: "Produce",
    perishable: false,
    staple: false,
    ...partial,
  };
}

function recipe(id: string, title: string, ingredients: Ingredient[]): Recipe {
  return {
    id,
    title,
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

describe("buildSources", () => {
  it("keys by buy_as||item and records each recipe's wording (item + note)", () => {
    const a = recipe("a", "Shakshuka", [ing({ item: "tomato", note: "small, diced" })]);
    const b = recipe("b", "Salad", [ing({ item: "tomato", note: "chopped" })]);
    const sources = buildSources([a, b]);
    const tomato = sources.get("tomato")!;
    expect(tomato).toHaveLength(2);
    expect(tomato.map((s) => s.recipeTitle).sort()).toEqual(["Salad", "Shakshuka"]);
    expect(tomato.find((s) => s.recipeId === "a")!.detail).toBe("tomato, small, diced");
    expect(tomato.find((s) => s.recipeId === "b")!.detail).toBe("tomato, chopped");
  });

  it("uses buy_as as the key when present", () => {
    const r = recipe("a", "Pasta", [ing({ item: "extra virgin olive oil", buy_as: "olive oil" })]);
    const sources = buildSources([r]);
    expect(sources.has("olive oil")).toBe(true);
    expect(sources.get("olive oil")![0].detail).toBe("extra virgin olive oil");
  });

  it("collapses repeats within one recipe into a single source, joining distinct phrasings", () => {
    const r = recipe("a", "Stew", [
      ing({ item: "onion", note: "diced" }),
      ing({ item: "onion", note: "sliced" }),
      ing({ item: "onion", note: "diced" }), // duplicate phrasing — dropped
    ]);
    const onion = buildSources([r]).get("onion")!;
    expect(onion).toHaveLength(1);
    expect(onion[0].detail).toBe("onion, diced; onion, sliced");
  });

  it("skips ingredients excluded from shopping, keeps staples", () => {
    const r = recipe("a", "Toast", [
      ing({ item: "water", exclude_from_shopping: true }),
      ing({ item: "salt", staple: true }),
    ]);
    const sources = buildSources([r]);
    expect(sources.has("water")).toBe(false);
    expect(sources.has("salt")).toBe(true);
  });
});
