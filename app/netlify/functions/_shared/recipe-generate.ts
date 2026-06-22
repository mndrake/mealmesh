// Pure, environment-neutral core for GENERATING new recipes (vs. importing them).
// The dataset's one-off recipes are too ingredient-heavy to sustain a monthly menu;
// this asks Claude for ultra-simple, diabetic, net-carb-bounded recipes that reuse a
// shared bulk-buy palette, then turns them into the same DraftRecipe the importer
// produces — so generated recipes flow into user_recipes and appear in Browse, the
// planner, shopping, and Kroger exactly like imported ones. No SDK/network here
// (anthropic.ts does the Claude call); this stays unit-testable.
import { z } from "zod";
import {
  SECTIONS,
  type Category,
  type Nutrition,
  type ParsedRecipe,
  type DraftRecipe,
  toDraftRecipe,
  randomId,
} from "./recipe-import";

export interface GenConstraints {
  /** How many recipes to ask for. */
  count: number;
  /** Meal role — drives prep-style expectations and the recipe category. */
  role: Category;
  /** Hard ceiling on distinct shoppable ingredients (pantry staples don't count). */
  maxIngredients: number;
  /** Per-serving net-carb ceiling (carb_g − fiber_g). */
  maxNetCarbs: number;
  /** Bulk-buy ingredients to reuse across recipes (keeps the shopping palette small). */
  palette?: string[];
  /** Exclude fish (seafood like shrimp is fine) — from the household brief. */
  noFish?: boolean;
  /** Target servings per recipe (default 2). */
  servings?: number;
}

const SectionEnum = z.enum(SECTIONS as [string, ...string[]]);

/** One generated recipe. Extends the import shape with the fields the ease-mode planner
 *  needs (prep_style / office_friendly / batch) so generated recipes slot into rotations. */
export const GeneratedRecipeSchema = z.object({
  title: z.string(),
  cuisine: z.string().nullable(),
  servings: z.number().int().positive(),
  prep_minutes: z.number().int().nonnegative().nullable(),
  cook_minutes: z.number().int().nonnegative().nullable(),
  prep_style: z.enum(["no_cook", "make_ahead", "cook"]),
  office_friendly: z.boolean(),
  batch: z.boolean(),
  ingredients: z.array(
    z.object({
      qty: z.number().nullable(),
      unit: z.string(),
      item: z.string(),
      section: SectionEnum,
      note: z.string(),
    })
  ),
  method: z.string(),
  notes: z.string(),
  nutrition: z.object({
    kcal: z.number(),
    carb_g: z.number(),
    fiber_g: z.number(),
    protein_g: z.number(),
    fat_g: z.number(),
  }),
});

export const GeneratedBatchSchema = z.object({ recipes: z.array(GeneratedRecipeSchema) });

export type GeneratedRecipe = z.infer<typeof GeneratedRecipeSchema>;
/** A generated recipe finalized into the full Recipe shape (with planner fields). */
export type GeneratedDraft = DraftRecipe & { office_friendly?: boolean; batch?: boolean };

export function netCarbsOf(n: Nutrition): number {
  return Math.max(0, n.carb_g - n.fiber_g);
}

// Common pantry staples don't count toward the simplicity ceiling and are held aside on
// the shopping list — so "3 ingredients" means 3 things to actually buy, not counting the
// oil and salt every kitchen has.
const STAPLE_RE =
  /\b(salt|pepper|olive oil|avocado oil|oil|cooking spray|water|ice|garlic powder|onion powder|cumin|paprika|chili powder|cinnamon|vanilla|baking soda|baking powder|cornstarch|spices?|seasoning|dried herbs?|oregano|thyme|basil)\b/i;

export function isPantryStaple(item: string): boolean {
  return STAPLE_RE.test(item);
}

const FISH_RE =
  /\b(fish|salmon|tuna|tilapia|cod|haddock|trout|sardine|anchovy|mackerel|halibut|catfish)\b/i;

export function generationSystemPrompt(): string {
  return `You design ultra-simple, diabetic-friendly recipes for sustainable weekly meal prep.
A good recipe here is something a busy person will actually make every week.
Rules:
- Keep it SIMPLE: at most the requested number of distinct shoppable ingredients. Do NOT count
  pantry staples (salt, pepper, oil, water, common dried spices) toward that limit, but you may
  still list them.
- Diabetic-friendly: net carbs (carb_g minus fiber_g) per serving must not exceed the requested
  ceiling. Favor non-starchy vegetables, lean protein, and healthy fats.
- Reuse the provided palette ingredients as much as possible so several recipes share one small
  shopping list. Introduce new ingredients only when necessary.
- Breakfasts and lunches must be make-ahead or no-cook and easy to pack for work
  (set office_friendly true for no-cook packable meals). Dinners should be simple and fast.
- Set batch true when the recipe holds well cooked once and reheated across several days.
- qty is a decimal number (1.5 for "1 ½"); unit is a short word ("cup", "tbsp", "oz") or "each".
  item is the bare ingredient (no qty/unit); put prep notes ("diced") in note.
- nutrition is your best honest per-serving estimate for all five fields.
- method is numbered plain-text steps; notes is short tips or "".`;
}

export function generationUserPrompt(c: GenConstraints): string {
  const lines = [
    `Create ${c.count} different ${c.role} recipes for ${c.servings ?? 2} people.`,
    `At most ${c.maxIngredients} shoppable ingredients each.`,
    `At most ${c.maxNetCarbs}g net carbs per serving.`,
  ];
  if (c.palette?.length) {
    lines.push(`Reuse these bulk-buy ingredients wherever sensible: ${c.palette.join(", ")}.`);
  }
  if (c.noFish) lines.push(`No fish (seafood such as shrimp is fine).`);
  lines.push(`Return them as the "recipes" array.`);
  return lines.join("\n");
}

function buildTags(net: number): string[] {
  const tags = ["generated", "diabetic-friendly"];
  if (net <= 20) tags.push("low-carb");
  return tags;
}

/** Finalize one generated recipe into a stored-ready draft, reusing the importer's
 *  section/perishable/id logic and layering on the planner fields + a "generated" mark. */
export function toGeneratedDraft(
  g: GeneratedRecipe,
  c: GenConstraints,
  idFactory: () => string = randomId
): GeneratedDraft {
  const parsed: ParsedRecipe = {
    title: g.title,
    category: c.role,
    cuisine: g.cuisine,
    servings: g.servings && g.servings > 0 ? g.servings : c.servings ?? 2,
    prep_minutes: g.prep_minutes ?? undefined,
    cook_minutes: g.cook_minutes ?? undefined,
    ingredients: g.ingredients.map((i) => ({
      qty: i.qty,
      unit: i.unit || "each",
      item: i.item,
      section: i.section as ParsedRecipe["ingredients"][number]["section"],
      note: i.note || undefined,
    })),
    method: g.method,
    notes: g.notes,
    nutrition: g.nutrition,
  };

  const draft = toDraftRecipe(parsed, "", idFactory);
  // Flag pantry staples so the palette/shopping math treats them as "already have it".
  for (const ing of draft.ingredients) ing.staple = isPantryStaple(ing.item);

  return {
    ...draft,
    prep_style: g.prep_style,
    office_friendly: g.office_friendly,
    batch: g.batch,
    nutrition_estimated: true, // model-estimated; flagged so the UI shows "est."
    tags: buildTags(netCarbsOf(g.nutrition)),
    source: { name: "Generated", note: "AI-generated; review before use" },
    method_is_link_only: false,
  };
}

/** Reasons a generated draft fails the constraints (empty = passes). Lets the caller drop
 *  or flag recipes that didn't honor the simplicity / net-carb / no-fish rules. */
export function validateGenerated(d: GeneratedDraft, c: GenConstraints): string[] {
  const reasons: string[] = [];
  const shoppable = d.ingredients.filter((i) => !i.staple).length;
  if (shoppable > c.maxIngredients) {
    reasons.push(`uses ${shoppable} shoppable ingredients (max ${c.maxIngredients})`);
  }
  const net = netCarbsOf(d.nutrition_per_serving);
  if (net > c.maxNetCarbs) {
    reasons.push(`${net}g net carbs > ${c.maxNetCarbs}g target`);
  }
  const hasNutrition = (["kcal", "carb_g", "protein_g", "fat_g"] as const).some(
    (k) => d.nutrition_per_serving[k] > 0
  );
  if (!hasNutrition) reasons.push("missing nutrition estimate");
  if (c.noFish && d.ingredients.some((i) => FISH_RE.test(i.item))) {
    reasons.push("contains fish");
  }
  return reasons;
}
