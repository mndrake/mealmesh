// POST /api/recipes/generate — authed. Body: generation constraints (role, count, limits,
// palette, noFish). Asks Claude for novel ultra-simple diabetic recipes and returns draft
// Recipes (with any constraint violations flagged) for the client to review and save. Not
// persisted here — the SPA writes the kept ones to user_recipes. Shares the AI-recipe rate
// limit with import (one Claude call per request).
import { getUser, householdIdFor, checkImportRateLimit } from "./_shared/supa";
import { generateRecipesWithClaude, hasClaude } from "./_shared/anthropic";
import { toGeneratedDraft, validateGenerated, type GenConstraints } from "./_shared/recipe-generate";
import type { Category } from "./_shared/recipe-import";
import { json } from "./_shared/http";

const LIMIT = 20;
const WINDOW_MS = 60 * 60 * 1000; // rolling hour, shared with import
const ROLES: Category[] = ["breakfast", "lunch", "dinner", "snack"];

function clamp(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export default async (req: Request): Promise<Response> => {
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const householdId = await householdIdFor(user.id);
  if (!householdId) return json({ error: "no household" }, 403);
  if (!hasClaude(process.env)) {
    return json({ error: "ai_unconfigured", detail: "Recipe generation isn't configured on the server." }, 422);
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const role = ROLES.includes(body.role as Category) ? (body.role as Category) : "dinner";
  const c: GenConstraints = {
    role,
    count: clamp(body.count, 1, 8, 4),
    maxIngredients: clamp(body.maxIngredients, 1, 15, 6),
    maxNetCarbs: clamp(body.maxNetCarbs, 0, 200, 15),
    servings: clamp(body.servings, 1, 12, 2),
    palette: Array.isArray(body.palette) ? body.palette.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20) : [],
    noFish: Boolean(body.noFish),
  };

  // Rate limit (durable, per household) — after validation, before the Claude call.
  const rl = await checkImportRateLimit(householdId, LIMIT, WINDOW_MS);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: "rate_limited", detail: `Too many AI recipe requests — try again in about ${Math.ceil(rl.retryAfterSec / 60)} min.` }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": String(rl.retryAfterSec) } }
    );
  }

  try {
    const generated = await generateRecipesWithClaude(process.env, c);
    const recipes = generated.map((g) => {
      const recipe = toGeneratedDraft(g, c);
      return { recipe, issues: validateGenerated(recipe, c) };
    });
    return json({ recipes });
  } catch (e) {
    console.warn("[recipe-generate] error:", (e as Error).message);
    return json({ error: "ai_failed", detail: (e as Error).message }, 502);
  }
};
