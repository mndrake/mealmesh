// Bridges Coach menu recipes into the app's Plan/Recipe world so a Coach week can populate the
// Plan tab and a working shopping list (PRD §6). SPA-only (not imported by the coach-ask
// function). Coach recipes are injected into the by-id recipe MAP (see allRecipes.ts) — not the
// Browse array or the plan generator.
import type { Ingredient, Nutrition, Plan, PlanDay, Recipe } from "../types";
import type { CoachRecipe, MealSlot, WeeklyMenu } from "./types";
import menuRecipeData from "../../data/coach/menu-recipes.json";
import menuIngredientsData from "../../data/coach/menu-ingredients.json";
import imageSourcesData from "../../data/coach/image-sources.json";

const COACH_RECIPES = menuRecipeData.recipes as CoachRecipe[];
const EXTRA = menuIngredientsData as unknown as Record<
  string,
  { nutrition: Nutrition; ingredients: Ingredient[] }
>;
interface ImgSrc { title: string; artist: string; license: string; licenseUrl: string; source: string }
const IMAGES = (imageSourcesData as { images?: Record<string, ImgSrc> }).images ?? {};

const SLOT_TO_CATEGORY: Record<MealSlot, Recipe["category"]> = {
  breakfast: "breakfast",
  lunch: "lunch",
  dinner: "dinner",
};

/** Adapt a self-contained Coach recipe to a full Recipe so it renders + shops like any other.
 *  Net carbs are exact (carb_g); kcal/protein/fat are 0 — the source plan only specifies net
 *  carbs, so they are intentionally not invented (nutrition_estimated = true). */
export function coachRecipeToRecipe(cr: CoachRecipe): Recipe {
  const extra = EXTRA[cr.id];
  const img = IMAGES[cr.id];
  const method = cr.steps.map((s, i) => `${i + 1}. ${s.text}`).join("\n");
  return {
    id: cr.id,
    title: cr.title,
    category: SLOT_TO_CATEGORY[cr.slot],
    cuisine: null,
    servings: cr.servings,
    prep_style: cr.no_cook ? "no_cook" : "cook",
    tags: ["diabetic-friendly", "low-carb", "coach"],
    nutrition_per_serving:
      extra?.nutrition ?? { kcal: 0, carb_g: cr.net_carbs_g, fiber_g: 0, protein_g: 0, fat_g: 0 },
    nutrition_estimated: true,
    ingredients: extra?.ingredients ?? [],
    method,
    notes: cr.note ?? "",
    method_is_link_only: false,
    imageUrl: img ? `/coach-images/${cr.id}.jpg` : null,
    image_source: img
      ? {
          file: img.title.replace(/^File:/, ""),
          page: img.source,
          repository: "Wikimedia Commons",
          note: `${img.artist} · ${img.license}`,
        }
      : undefined,
  };
}

/** Bundled photo path for a coach recipe, or null if none was sourced. */
export function coachImageUrl(id: string): string | null {
  return IMAGES[id] ? `/coach-images/${id}.jpg` : null;
}

export function coachRecipesAsRecipes(): Recipe[] {
  return COACH_RECIPES.map(coachRecipeToRecipe);
}

export function coachRecipesById(): Map<string, Recipe> {
  return new Map(coachRecipesAsRecipes().map((r) => [r.id, r]));
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Turn a weekly menu into a 7-day Plan: breakfast + lunch are batch-prepped, so they fill
 *  Mon–Fri with leftover flags (cooked Monday, leftover the rest — so shopping counts the batch
 *  once); dinners land on their day; weekends are left open. */
export function menuToPlan(menu: WeeklyMenu): Plan {
  return DAYS.map((day, i): PlanDay => {
    const weekday = i < 5;
    const dinner = menu.dinners.find((d) => d.day === day);
    return {
      day,
      breakfast: weekday ? { id: menu.breakfast_id, leftover: i > 0 } : null,
      lunch: weekday ? { id: menu.lunch_id, leftover: i > 0 } : null,
      dinner: dinner ? { id: dinner.recipe_id, leftover: false } : null,
      snack: null,
    };
  });
}
