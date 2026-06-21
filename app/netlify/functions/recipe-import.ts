// POST /api/recipes/import — authed. Body: { url }. Fetches the page server-side, extracts
// a recipe from its schema.org JSON-LD, and falls back to Claude for pages without it.
// Returns a draft Recipe for the client to review and save (it is NOT persisted here —
// the SPA writes it to user_recipes after the user confirms). The fetch is SSRF-guarded
// and the response is size/time-capped.
import { getUser, householdIdFor, checkImportRateLimit, uploadRecipeImage } from "./_shared/supa";
import {
  isSafeImportUrl,
  htmlToText,
  extractJsonLdRecipe,
  extractOgImage,
  imageExtFromContentType,
  toDraftRecipe,
  type DraftRecipe,
} from "./_shared/recipe-import";
import { extractRecipeWithClaude, extractRecipeViaWebFetch, findRecipeImageUrl, hasClaude } from "./_shared/anthropic";
import { json } from "./_shared/http";

const MAX_BYTES = 3_000_000; // 3 MB of HTML is plenty for a recipe page
const MAX_IMAGE_BYTES = 5_000_000; // matches the storage bucket's 5 MB limit
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

/** Download an image (SSRF-guarded, content-type + size capped). Returns bytes + ext, or null. */
async function downloadImage(url: string): Promise<{ bytes: Uint8Array; contentType: string; ext: string } | null> {
  if (!isSafeImportUrl(url)) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { accept: "image/*" } });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    const ext = imageExtFromContentType(contentType);
    if (!ext) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;
    return { bytes: new Uint8Array(buf), contentType: contentType.split(";")[0].trim(), ext };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Best-effort: resolve a photo for the recipe (page image, else AI web search), re-host it
 *  in Supabase Storage, and set imageUrl + attribution on the draft. Never throws. */
async function attachImage(householdId: string, recipe: DraftRecipe, candidate: string | null): Promise<void> {
  let src = candidate;
  if (!src && hasClaude(process.env)) src = await findRecipeImageUrl(process.env, recipe.title);
  if (!src) return;
  const img = await downloadImage(src);
  if (!img) return;
  const hosted = await uploadRecipeImage(householdId, recipe.id, img.bytes, img.contentType, img.ext);
  if (hosted) {
    recipe.imageUrl = hosted;
    recipe.image_source = { page: src, note: candidate ? "Imported from the recipe page" : "Found via web search" };
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

  // Resolve a draft recipe + a candidate image URL.
  let recipe: DraftRecipe;
  let via: "jsonld" | "ai" | "ai_fetch";
  let candidate: string | null = null;

  const fromJsonLd = html ? extractJsonLdRecipe(html) : null;
  if (fromJsonLd) {
    // 1) Structured data — reliable and free.
    recipe = toDraftRecipe(fromJsonLd, url);
    via = "jsonld";
    candidate = fromJsonLd.imageUrl ?? extractOgImage(html!);
  } else {
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
      recipe = toDraftRecipe(parsed, url);
      via = html ? "ai" : "ai_fetch";
      candidate = parsed.imageUrl ?? (html ? extractOgImage(html) : null);
    } catch (e) {
      console.warn("[recipe-import] AI extract error:", (e as Error).message);
      return json({ error: "ai_failed", detail: (e as Error).message }, 502);
    }
  }

  // Best-effort: re-host the page's image (or an AI-found one) so it serves from our origin.
  await attachImage(householdId, recipe, candidate);

  return json({ recipe, via });
};
