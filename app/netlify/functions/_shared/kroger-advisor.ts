// AI advisor for product matching: given shopping-list items whose Kroger match looks wrong
// (e.g. shallots matched to a Deli product), ask Claude to pick the right product from the
// candidates — or suggest a better search term when none fit. Server-only (ANTHROPIC_API_KEY).
// Kept separate from the handler so the prompt/shape are easy to reason about and test.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

type Env = Record<string, string | undefined>;

export interface AdvisorCandidate {
  upc: string;
  description: string;
  department: string | null;
  price: number | null;
}
export interface AdvisorItem {
  name: string; // the recipe shopping-list name
  section?: string | null; // the expected grocery aisle
  candidates: AdvisorCandidate[];
}
export interface AdvisorPick {
  name: string;
  chosenUpc: string | null; // UPC of the best candidate, or null if none fit
  betterTerm: string | null; // a better search term to try when nothing fits
}

const Schema = z.object({
  picks: z.array(
    z.object({
      name: z.string(),
      chosenUpc: z.string().nullable(),
      betterTerm: z.string().nullable(),
    })
  ),
});

const SYSTEM = `You match recipe shopping-list items to the correct Kroger grocery product.
For each item, pick the candidate UPC a home cook actually wants:
- Prefer the basic raw ingredient in its expected aisle over prepared/deli/bakery/seasoning-blend
  products (e.g. fresh shallots in Produce, NOT a deli shallot dish or shallot vinaigrette).
- Match the form implied by the item name (whole vs ground, fresh vs dried, etc.).
- If one candidate clearly fits, return its exact upc as chosenUpc (betterTerm null).
- If NONE of the candidates are a good match, set chosenUpc null and provide betterTerm: a short,
  plain grocery search term to try instead (e.g. "shallot").
Return exactly one entry per input item, echoing its name.`;

/** True when the AI advisor is configured. */
export function hasClaude(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/** Ask Claude to choose the best product (or a better term) for each questionable item. One
 *  batched call. Returns [] on any failure so the caller falls back to the heuristic match. */
export async function adviseMatches(env: Env, items: AdvisorItem[]): Promise<AdvisorPick[]> {
  if (!items.length || !env.ANTHROPIC_API_KEY) return [];
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const res = await client.messages.parse({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(Schema), effort: "low" },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            items: items.map((it) => ({
              name: it.name,
              expected_aisle: it.section ?? null,
              candidates: it.candidates.map((c) => ({
                upc: c.upc,
                description: c.description,
                department: c.department,
                price: c.price,
              })),
            })),
          }),
        },
      ],
    });
    return res.parsed_output?.picks ?? [];
  } catch {
    return [];
  }
}
