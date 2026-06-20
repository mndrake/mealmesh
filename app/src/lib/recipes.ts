import data from "../data/recipes.json";
import type { Recipe } from "./types";
import { normalizeForDisplay } from "./normalize";

// Raw recipes exactly as built from recipe-repo, in sorted-path order (matches the
// Python loader). The parity tests run against THESE so the TS planner/shopping ports
// stay byte-faithful to the read-only Python reference, which can't see our overrides.
export const rawRecipes = data as unknown as Recipe[];
export const rawRecipesById: Map<string, Recipe> = new Map(
  rawRecipes.map((r) => [r.id, r])
);

// App-facing recipes with mislabeled ingredient names and store sections corrected
// (see normalize.ts). Same identity/order/count as rawRecipes — only ingredient
// item/section strings change — so planner behavior is unaffected.
export const recipes: Recipe[] = normalizeForDisplay(rawRecipes);

export const recipesById: Map<string, Recipe> = new Map(
  recipes.map((r) => [r.id, r])
);

export function getRecipe(id: string): Recipe | undefined {
  return recipesById.get(id);
}
