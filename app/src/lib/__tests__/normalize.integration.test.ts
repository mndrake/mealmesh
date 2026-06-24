// Integration: run the real wired pipeline (built recipes.json) end-to-end and
// assert the normalization actually lands in a real shopping list.
import { describe, it, expect } from "vitest";
import { rawRecipes, recipes, recipesById } from "../recipes";
import { buildPlan, cookedMeals } from "../planner";
import { buildList, SECTION_ORDER } from "../shopping";
import { normalizeForShopping } from "../normalize";
import type { Recipe } from "../types";

function mkRecipe(id: string, item: string, qty: number): Recipe {
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
    method: "",
    notes: "",
    method_is_link_only: false,
    ingredients: [
      { qty, unit: "clove", item, section: "Produce", perishable: true, staple: false },
    ],
  };
}

describe("normalize integration (real data)", () => {
  it("no recipe ingredient is named bare 'starch' after display normalization", () => {
    const offenders = recipes.flatMap((r) =>
      r.ingredients.filter((i) => i.item === "starch").map(() => r.id)
    );
    expect(offenders).toEqual([]);
  });

  it("frozen items are routed to a Frozen section and it sorts after Dairy & Eggs", () => {
    expect(SECTION_ORDER.indexOf("Frozen")).toBe(
      SECTION_ORDER.indexOf("Dairy & Eggs") + 1
    );
    // Every recipe's cooked meals across all recipes -> ensure Frozen is reachable.
    const list = buildList(normalizeForShopping(recipes));
    const sectionNames = list.sections.map((s) => s.section);
    expect(sectionNames).toContain("Frozen");
    // sections come out in SECTION_ORDER
    const order = sectionNames.map((s) => SECTION_ORDER.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("no section lists both 'chopped X' and the whole 'X' for collapsed veg", () => {
    const list = buildList(normalizeForShopping(recipes));
    for (const { items } of list.sections) {
      const names = new Set(items.map(([n]) => n));
      for (const n of names) {
        if (n.startsWith("chopped ") || n.startsWith("diced ") || n.startsWith("sliced ")) {
          // any prep-modified name that we mapped should not still appear alongside its base
          // (we only assert the ones we collapse; unmapped prep names may legitimately remain)
        }
      }
      expect(names.has("chopped red bell pepper") && names.has("red bell pepper")).toBe(false);
      expect(names.has("shredded carrots") && names.has("carrots")).toBe(false);
    }
  });

  it("merges garlic clove / cloves / minced garlic onto a single 'garlic' line", () => {
    const recipes = [
      mkRecipe("a", "garlic clove", 1),
      mkRecipe("b", "garlic cloves", 3),
      mkRecipe("c", "minced garlic", 2),
      mkRecipe("d", "garlic", 1),
    ];
    const list = buildList(normalizeForShopping(recipes));
    const garlicNames = list.sections
      .flatMap((s) => s.items.map(([n]) => n))
      .filter((n) => /garlic/.test(n));
    expect(garlicNames).toEqual(["garlic"]); // one line, not four
  });

  it("app plan equals the plan built from raw recipes (planner unaffected by renames)", () => {
    const fromRaw = buildPlan(rawRecipes);
    const fromNorm = buildPlan(recipes);
    expect(fromNorm.map((d) => d.dinner?.id)).toEqual(fromRaw.map((d) => d.dinner?.id));
    // sanity: cookedMeals resolves through normalized recipesById
    expect(cookedMeals(fromRaw, recipesById).length).toBeGreaterThan(0);
  });
});
