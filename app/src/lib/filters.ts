// Search + filtering for the recipe browser, plus cuisine derivation that merges
// the `cuisine` field with cuisine-valued tags (per the chosen design).
import type { Recipe, Category, PrepStyle } from "./types";

export const DIET_TAGS = [
  "diabetic-friendly",
  "low-carb",
  "low-calorie",
  "high-protein",
  "vegetarian",
  "no-fish",
  "office-friendly",
  "make-ahead",
  "no-cook",
];

export interface Filters {
  search: string;
  categories: Category[];
  tags: string[]; // ALL must match
  cuisine: string | null; // lowercase key
  prepStyle: PrepStyle | null;
  maxCarbs: number | null;
  maxKcal: number | null;
  maxTotalTime: number | null; // prep + cook minutes
  realNutritionOnly: boolean;
  favoritesOnly: boolean;
}

export function emptyFilters(): Filters {
  return {
    search: "",
    categories: [],
    tags: [],
    cuisine: null,
    prepStyle: null,
    maxCarbs: null,
    maxKcal: null,
    maxTotalTime: null,
    realNutritionOnly: false,
    favoritesOnly: false,
  };
}

/** lowercase-cuisine -> display name, sourced from the `cuisine` field. */
export function cuisineIndex(recipes: Recipe[]): Map<string, string> {
  const display = new Map<string, string>();
  for (const r of recipes) {
    if (r.cuisine) {
      const lc = r.cuisine.toLowerCase();
      if (!display.has(lc)) display.set(lc, r.cuisine);
    }
  }
  return display;
}

/** A recipe is "in" a cuisine if its field matches OR it carries the cuisine as a tag. */
export function matchesCuisine(r: Recipe, lc: string): boolean {
  return (r.cuisine?.toLowerCase() === lc) || r.tags.includes(lc);
}

export function totalTime(r: Recipe): number {
  return (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0);
}

function haystack(r: Recipe): string {
  return [
    r.title,
    r.cuisine ?? "",
    r.tags.join(" "),
    r.ingredients.map((i) => i.item).join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

export function applyFilters(
  recipes: Recipe[],
  f: Filters,
  favorites: Set<string>
): Recipe[] {
  const q = f.search.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  return recipes.filter((r) => {
    if (f.categories.length && !f.categories.includes(r.category)) return false;
    if (f.tags.length && !f.tags.every((t) => r.tags.includes(t))) return false;
    if (f.cuisine && !matchesCuisine(r, f.cuisine)) return false;
    if (f.prepStyle && r.prep_style !== f.prepStyle) return false;
    if (f.maxCarbs != null && r.nutrition_per_serving.carb_g > f.maxCarbs) return false;
    if (f.maxKcal != null && r.nutrition_per_serving.kcal > f.maxKcal) return false;
    if (f.maxTotalTime != null && totalTime(r) > f.maxTotalTime) return false;
    if (f.realNutritionOnly && r.nutrition_estimated) return false;
    if (f.favoritesOnly && !favorites.has(r.id)) return false;
    if (terms.length) {
      const h = haystack(r);
      if (!terms.every((t) => h.includes(t))) return false;
    }
    return true;
  });
}
