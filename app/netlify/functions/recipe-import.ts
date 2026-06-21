// POST /api/recipes/import — authed. Body: { url }. Fetches the page server-side, extracts
// a recipe from its schema.org JSON-LD, and falls back to Claude for pages without it.
// Returns a draft Recipe for the client to review and save (it is NOT persisted here —
// the SPA writes it to user_recipes after the user confirms). The fetch is SSRF-guarded
// and the response is size/time-capped.
import { getUser, householdIdFor, checkImportRateLimit } from "./_shared/supa";
import { isSafeImportUrl, htmlToText, extractJsonLdRecipe, toDraftRecipe } from "./_shared/recipe-import";
import { extractRecipeWithClaude, extractRecipeViaWebFetch, hasClaude } from "./_shared/anthropic";
import { json } from "./_shared/http";

const MAX_BYTES = 3_000_000; // 3 MB of HTML is plenty for a recipe page
const FETCH_TIMEOUT_MS = 12_000;

// Per-household quota: caps Anthropic spend + fetch abuse. Generous for a family adding
// recipes; a runaway client is stopped well before it costs much.
const IMPORT_LIMIT = 20;
const IMPORT_WINDOW_MS = 60 * 60 * 1000; // rolling hour

async function fetchPage(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        // identify as a normal browser; some sites 403 unknown agents
        "user-agent": "Mozilla/5.0 (compatible; MealMesh/1.0; +https://mealmesh.app)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) throw new Error(`fetch_failed_${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (!/html|xml|text/i.test(ct)) throw new Error("not_html");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new Error("too_large");
    return new TextDecoder("utf-8").decode(buf);
  } finally {
    clearTimeout(t);
  }
}

export default async (req: Request): Promise<Response> => {
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const householdId = await householdIdFor(user.id);
  if (!householdId) return json({ error: "no household" }, 403);

  const body = (await req.json().catch(() => ({}))) as { url?: string };
  const url = (body.url ?? "").trim();
  if (!url || !isSafeImportUrl(url)) return json({ error: "bad_url" }, 400);

  // Rate limit (durable, per household) — checked after URL validation so malformed
  // requests don't consume quota, before any fetch/AI work.
  const rl = await checkImportRateLimit(householdId, IMPORT_LIMIT, IMPORT_WINDOW_MS);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: "rate_limited", detail: `Too many imports — try again in about ${Math.ceil(rl.retryAfterSec / 60)} min.` }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": String(rl.retryAfterSec) } }
    );
  }

  // Try our own fetch first (cheap). If it works, prefer JSON-LD, then AI over the text we
  // already have. If it's blocked (anti-bot 403, etc.), fall back to Claude's web-fetch tool.
  let html: string | null = null;
  let fetchErr = "";
  try {
    html = await fetchPage(url);
  } catch (e) {
    fetchErr = (e as Error).message;
  }

  // 1) Structured data — reliable and free.
  if (html) {
    const fromJsonLd = extractJsonLdRecipe(html);
    if (fromJsonLd) return json({ recipe: toDraftRecipe(fromJsonLd, url), via: "jsonld" });
  }

  // 2) Claude — extract from the text we fetched, or have Claude fetch the page itself.
  if (!hasClaude(process.env)) {
    return html
      ? json({ error: "no_structured_data", detail: "This page has no machine-readable recipe and AI import isn't configured." }, 422)
      : json({ error: "fetch_failed", detail: fetchErr }, 502);
  }
  try {
    const parsed = html
      ? await extractRecipeWithClaude(process.env, htmlToText(html), url)
      : await extractRecipeViaWebFetch(process.env, url);
    if (!parsed.ingredients?.length) return json({ error: "no_recipe", detail: "Couldn't find a recipe on that page." }, 422);
    return json({ recipe: toDraftRecipe(parsed, url), via: html ? "ai" : "ai_fetch" });
  } catch (e) {
    console.warn("[recipe-import] AI extract error:", (e as Error).message);
    return json({ error: "ai_failed", detail: (e as Error).message }, 502);
  }
};
