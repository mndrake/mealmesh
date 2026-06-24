// Claude fallback for recipe import: when a page has no usable schema.org JSON-LD, ask
// Claude to extract the recipe from the page text into our structured shape. Kept out of
// the pure helper (recipe-import.ts) so that stays testable. Uses the official Anthropic
// TypeScript SDK; ANTHROPIC_API_KEY is a server-only secret (Netlify function env).
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { SECTIONS, type ParsedRecipe } from "./recipe-import";
import {
  GeneratedBatchSchema,
  generationSystemPrompt,
  generationUserPrompt,
  type GenConstraints,
  type GeneratedRecipe,
} from "./recipe-generate";

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
  image_url: z.string().nullable(),
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

const SYSTEM = `You extract a single cooking recipe from a web page into a strict JSON shape.
Rules:
- Use only what the page states; do not invent ingredients, steps, or nutrition. Omit unknown numbers as null.
- qty is the numeric amount as a decimal (e.g. 1.5 for "1 ½"); unit is a short unit word ("cup", "tbsp", "g") or "each" when there is no unit.
- item is the bare ingredient name (no quantity/unit); put prep notes ("finely chopped") in note.
- section must be the best-fit grocery aisle from the allowed list.
- method is the numbered steps as plain text; notes is any extra tips (or "").
- image_url is the URL of the dish's main photo on the page (a direct https image URL), or null.
- nutrition is per single serving if the page gives it, else null.`;

type ParsedOut = z.infer<typeof RecipeSchema>;

/** Map Claude's validated output to our ParsedRecipe intermediate. */
function toParsed(out: ParsedOut): ParsedRecipe {
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
    imageUrl: out.image_url ?? undefined,
  };
}

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
  return toParsed(out);
}

/** Generate a batch of novel, ultra-simple, diabetic recipes from constraints (no source
 *  page — Claude designs them). Returns the validated recipes; the caller finalizes each
 *  with toGeneratedDraft. Throws if the key is missing or parsing fails. */
export async function generateRecipesWithClaude(
  env: Env,
  c: GenConstraints
): Promise<GeneratedRecipe[]> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ai_unconfigured");
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  // Kept fast and small so it returns within Netlify's ~10s synchronous function timeout:
  // a quick model and a token budget sized to a handful of short recipes. The client requests
  // recipes in small batches (see the modal), so a single call never produces many at once.
  // NOTE: `effort` is NOT passed — Haiku 4.5 rejects output_config.effort (it's Opus/Sonnet-4.6
  // only); including it 400s the request.
  const res = await client.messages.parse({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    output_config: { format: zodOutputFormat(GeneratedBatchSchema) },
    system: generationSystemPrompt(),
    messages: [{ role: "user", content: generationUserPrompt(c) }],
  });

  const out = res.parsed_output;
  if (!out) throw new Error("ai_parse_failed");
  return out.recipes;
}

const CoachAnswerSchema = z.object({ answer: z.string() });

/** Phrase a coach answer in one short call (PRD §7.3, ADR 0002). The grounding passed in the
 *  user prompt is authoritative — the system prompt forbids contradicting it. A small Haiku
 *  call keeps it well within Netlify's ~10s timeout. Throws if unconfigured; the handler falls
 *  back to the deterministic grounding text.
 *  NOTE: `effort` is NOT passed — Haiku 4.5 rejects output_config.effort (Opus/Sonnet-4.6 only);
 *  including it 400s the request, which previously made every coach Ask fall back to an error. */
export async function phraseCoachAnswer(
  env: Env,
  system: string,
  user: string
): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ai_unconfigured");
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const res = await client.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 600,
    output_config: { format: zodOutputFormat(CoachAnswerSchema) },
    system,
    messages: [{ role: "user", content: user }],
  });
  const out = res.parsed_output;
  if (!out?.answer) throw new Error("ai_parse_failed");
  return out.answer;
}

const ImageSchema = z.object({ image_url: z.string().nullable() });

/** Find a representative, openly-licensed photo for a dish via web search. Best-effort —
 *  returns a direct image URL or null. The caller validates + re-hosts it. */
export async function findRecipeImageUrl(env: Env, title: string): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const res = await client.messages.parse({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      output_config: { format: zodOutputFormat(ImageSchema), effort: "low" },
      system:
        "Find one representative photo of the described dish. Return image_url as a direct, " +
        "hotlinkable https URL to an image file (.jpg/.png/.webp). Strongly prefer openly-licensed " +
        "sources (Wikimedia Commons). Return null if you can't find a suitable, directly-linkable image.",
      messages: [{ role: "user", content: `A photo of this dish: ${title}` }],
    });
    const url = res.parsed_output?.image_url ?? null;
    return url && /^https:\/\//i.test(url) ? url : null;
  } catch {
    return null; // image search is best-effort; never block the import
  }
}

/** Let Claude fetch the page itself (server-side web-fetch tool) and extract the recipe.
 *  Used when our own fetch is blocked (anti-bot 403, JS-rendered pages, etc.). The fetch is
 *  scoped to the target host so Claude can't wander to other sites. */
export async function extractRecipeViaWebFetch(env: Env, url: string): Promise<ParsedRecipe> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ai_unconfigured");
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* url was validated upstream */
  }

  const res = await client.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    // Server-side web fetch (dynamic filtering built in on Opus 4.8; no beta header needed),
    // scoped to the recipe's own domain and bounded to a couple of fetches.
    tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, ...(host ? { allowed_domains: [host] } : {}) }],
    output_config: { format: zodOutputFormat(RecipeSchema), effort: "medium" },
    system: SYSTEM,
    messages: [{ role: "user", content: `Fetch this recipe page and extract the recipe: ${url}` }],
  });

  const out = res.parsed_output;
  if (!out) throw new Error("ai_parse_failed");
  return toParsed(out);
}
