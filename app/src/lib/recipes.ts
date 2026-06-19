import data from "../data/recipes.json";
import type { Recipe } from "./types";

// Recipes in sorted-path order (matches the Python loader). Order matters:
// the planner's greedy "first-max-wins" tie-breaking depends on it.
export const recipes = data as unknown as Recipe[];

export const recipesById: Map<string, Recipe> = new Map(
  recipes.map((r) => [r.id, r])
);

export function getRecipe(id: string): Recipe | undefined {
  return recipesById.get(id);
}
