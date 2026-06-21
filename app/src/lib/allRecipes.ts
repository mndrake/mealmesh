// Merge the bundled (read-only) recipe set with the household's imported recipes so the UI
// treats them uniformly. Bundled recipes still drive plan *generation* (planner uses
// rawRecipes directly — imported recipes don't participate, they aren't parity-bound); this
// layer is for display, browsing, and resolving a recipe id anywhere in the app.
import { useMemo } from "react";
import type { Recipe } from "./types";
import { recipes as bundled, recipesById as bundledById } from "./recipes";
import { useStore, getState } from "./store";

/** Imported recipes first (most relevant to the user), then the bundled set. */
export function mergeRecipes(userRecipes: Recipe[]): Recipe[] {
  return userRecipes.length ? [...userRecipes, ...bundled] : bundled;
}

export function mergeRecipesById(userRecipes: Recipe[]): Map<string, Recipe> {
  if (!userRecipes.length) return bundledById;
  const m = new Map(bundledById);
  for (const r of userRecipes) m.set(r.id, r);
  return m;
}

/** Reactive: bundled + imported recipes, recomputed when imports change. */
export function useAllRecipes(): Recipe[] {
  const user = useStore((s) => s.userRecipes);
  return useMemo(() => mergeRecipes(user), [user]);
}

/** Reactive id→recipe lookup across bundled + imported recipes. */
export function useAllRecipesById(): Map<string, Recipe> {
  const user = useStore((s) => s.userRecipes);
  return useMemo(() => mergeRecipesById(user), [user]);
}

/** Non-reactive lookup for actions / non-component code (reads current store state). */
export function allRecipesById(): Map<string, Recipe> {
  return mergeRecipesById(getState().userRecipes);
}
