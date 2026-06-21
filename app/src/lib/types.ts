// Shared types for the MealMesh app. Recipe shape mirrors recipe-repo/schema/recipe.json,
// plus two UI-critical fields the schema allows but does not require (cuisine, nutrition_estimated).

export type Category = "breakfast" | "lunch" | "dinner" | "snack";
export type PrepStyle = "no_cook" | "make_ahead" | "cook";
export type Section =
  | "Produce"
  | "Meat & Poultry"
  | "Dairy & Eggs"
  | "Frozen"
  | "Bakery"
  | "Canned Goods (Soups, vegetables, and pasta sauces, etc.)"
  | "Pantry & Dry Goods"
  | "Condiments & Spices";

export interface Ingredient {
  qty: number | null;
  unit: string;
  item: string;
  section: Section;
  perishable: boolean;
  staple: boolean;
  buy_as?: string;
  exclude_from_shopping?: boolean;
  optional?: boolean;
  note?: string;
  /** Set by normalize.ts when display normalization changed the item name and/or
   *  section, so the UI can show what the original recipe data said. */
  normalizedFrom?: { item?: string; section?: Section };
}

export interface Nutrition {
  kcal: number;
  carb_g: number;
  fiber_g: number;
  protein_g: number;
  fat_g: number;
}

export interface RecipeSource {
  name?: string;
  url?: string;
  note?: string;
}

export interface ImageSource {
  file?: string;
  page?: string;
  repository?: string;
  note?: string;
}

export interface Recipe {
  id: string;
  title: string;
  category: Category;
  cuisine: string | null;
  servings: number;
  serving_size?: string;
  prep_minutes?: number;
  cook_minutes?: number;
  prep_style: PrepStyle;
  office_friendly?: boolean;
  batch?: boolean;
  tags: string[];
  nutrition_per_serving: Nutrition;
  /** true = auto-estimated (show "est." badge); false/absent = published value. */
  nutrition_estimated: boolean;
  source?: RecipeSource;
  image?: string;
  /** App-served image path (/recipe-images/<id>.jpg), or null if no image. */
  imageUrl: string | null;
  image_source?: ImageSource;
  ingredients: Ingredient[];
  /** Rendered method markdown (full text for hand-authored; a "see source" line for imported). */
  method: string;
  /** Rendered notes markdown, if any. */
  notes: string;
  /** true when the method is just a link out to source.url (imported recipes). */
  method_is_link_only: boolean;
}

// ---- Plan / persistence ----

export interface MealRef {
  id: string;
  leftover: boolean;
}

export interface PlanDay {
  day: string; // Mon..Sun
  breakfast: MealRef | null;
  lunch: MealRef | null;
  dinner: MealRef | null;
  snack: MealRef | string | null; // planner uses canned snack strings; manual picks use MealRef
}

export type Plan = PlanDay[];

// ---- Cooked tracking (M3) ----

/** One "I made this" event with optional quick feedback. Mirrors a cook_log row. */
export interface CookEvent {
  id: string;
  recipeId: string;
  cookedOn: string; // 'YYYY-MM-DD'
  rating: number | null; // 1..5
  makeAgain: boolean | null; // thumbs up/down
  notes: string | null;
  planId: string | null;
}
