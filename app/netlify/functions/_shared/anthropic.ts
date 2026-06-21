// Claude fallback for recipe import: when a page has no usable schema.org JSON-LD, ask
// Claude to extract the recipe from the page text into our structured shape. Kept out of
// the pure helper (recipe-import.ts) so that stays testable. Uses the official Anthropic
// TypeScript SDK; ANTHROPIC_API_KEY is a server-only secret (Netlify function env).
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { SECTIONS, type ParsedRecipe } from "./recipe-import";

type Env = Record<string, string | undefined>;

const SectionEnum = z.enum(SECTIONS as [string, ...string[]]);

const RecipeSchema = z.object({
  title: z.string(),
  category: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  cuisine: z.string().nullable(),
  servings: z.number().int().positive(),
  prep_minutes: z.number().int().nonnegative().nullable(),
  cook_minutes: z.number().int().nonnegative().nullable(),
  ingredients: z.array(
    z.object({
      qty: z.number().nullable(),
      unit: z.string(),
      item: z.string(),
      section: SectionEnum,
      optional: z.boolean(),
      note: z.string(),
    })
  ),
  method: z.string(),
  notes: z.string(),
  nutrition: z
    .object({
      kcal: z.number(),
      carb_g: z.number(),
      fiber_g: z.number(),
      protein_g: z.number(),
      fat_g: z.number(),
    })
    .nullable(),
});

const SYSTEM = `You extract a single cooking recipe from the text of a web page into a strict JSON shape.
Rules:
- Use only what the page states; do not invent ingredients, steps, or nutrition. Omit unknown numbers as null.
- qty is the numeric amount as a decimal (e.g. 1.5 for "1 ½"); unit is a short unit word ("cup", "tbsp", "g") or "each" when there is no unit.
- item is the bare ingredient name (no quantity/unit); put prep notes ("finely chopped") in note.
- section must be the best-fit grocery aisle from the allowed list.
- method is the numbered steps as plain text; notes is any extra tips (or "").
- nutrition is per single serving if the page gives it, else null.`;

/** True when the Claude fallback is configured (the API key is present). */
export function hasClaude(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/** Extract a recipe from page text with Claude. Throws if the key is missing or parsing
 *  fails so the handler can report a clean error. */
export async function extractRecipeWithClaude(env: Env, pageText: string, url: string): Promise<ParsedRecipe> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ai_unconfigured");
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const res = await client.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { format: zodOutputFormat(RecipeSchema), effort: "medium" },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Extract the recipe from this page (source: ${url}).\n\n${pageText}`,
      },
    ],
  });

  const out = res.parsed_output;
  if (!out) throw new Error("ai_parse_failed");
  return {
    title: out.title,
    category: out.category,
    cuisine: out.cuisine,
    servings: out.servings,
    prep_minutes: out.prep_minutes ?? undefined,
    cook_minutes: out.cook_minutes ?? undefined,
    ingredients: out.ingredients.map((i) => ({
      qty: i.qty,
      unit: i.unit || "each",
      item: i.item,
      section: i.section as ParsedRecipe["ingredients"][number]["section"],
      optional: i.optional || undefined,
      note: i.note || undefined,
    })),
    method: out.method,
    notes: out.notes,
    nutrition: out.nutrition ?? undefined,
  };
}
