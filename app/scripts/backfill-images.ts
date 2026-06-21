// Maintainer one-off: backfill images for imported recipes that don't have one yet (created
// before the image feature). For each user_recipes row lacking `data.imageUrl`, it finds a
// photo (the source page's JSON-LD/og:image, else an AI web search) and re-hosts it in the
// `recipe-images` Storage bucket — exactly like the runtime importer — then updates the row.
//
//   npm run backfill:images                    # all households (dry run with --dry-run)
//   npm run backfill:images -- --household <id> --dry-run
//   npm run backfill:images -- --household <id> --limit 50
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (required), ANTHROPIC_API_KEY (AI fallback).
// Requires migration 0012 (the recipe-images bucket) to be applied first.
import {
  isSafeImportUrl,
  extractJsonLdRecipe,
  extractOgImage,
  imageExtFromContentType,
} from "../netlify/functions/_shared/recipe-import";
import { findRecipeImageUrl, hasClaude } from "../netlify/functions/_shared/anthropic";
import { service, uploadRecipeImage } from "../netlify/functions/_shared/supa";

interface Args {
  household: string | null;
  dryRun: boolean;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { household: null, dryRun: false, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--household") a.household = argv[++i];
    else if (v === "--dry-run") a.dryRun = true;
    else if (v === "--limit") a.limit = Number(argv[++i]) || 0;
    else die(`unknown flag: ${v}`);
  }
  return a;
}

function die(msg: string): never {
  console.error(`\n[backfill-images] ${msg}\n`);
  process.exit(1);
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_IMAGE_BYTES = 5_000_000;

async function fetchPage(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; MealMesh/1.0)", accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) return null;
    if (!/html|xml|text/i.test(res.headers.get("content-type") || "")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

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

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Resolve a candidate image URL for a recipe: its source page first, then AI web search. */
async function findCandidate(recipe: any, sourceUrl: string | null, allowAi: boolean): Promise<string | null> {
  const url = sourceUrl || recipe?.source?.url || null;
  if (url && isSafeImportUrl(url)) {
    const html = await fetchPage(url);
    if (html) {
      const fromJsonLd = extractJsonLdRecipe(html)?.imageUrl;
      const candidate = fromJsonLd ?? extractOgImage(html);
      if (candidate) return candidate;
    }
  }
  if (allowAi) return findRecipeImageUrl(process.env, recipe?.title ?? "");
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.SUPABASE_URL && !process.env.VITE_SUPABASE_URL) die("SUPABASE_URL is required");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) die("SUPABASE_SERVICE_ROLE_KEY is required");
  const allowAi = hasClaude(process.env);
  if (!allowAi) console.warn("[backfill-images] ANTHROPIC_API_KEY not set — page images only, no AI fallback");

  const db = service();
  let q = db.from("user_recipes").select("id,household_id,source_url,data");
  if (args.household) q = q.eq("household_id", args.household);
  const { data, error } = await q;
  if (error) die(`query failed: ${error.message}`);

  const rows = (data ?? []).filter((r: any) => !r.data?.imageUrl);
  const todo = args.limit ? rows.slice(0, args.limit) : rows;
  console.log(`[backfill-images] ${rows.length} recipe(s) without an image${args.limit ? ` (processing ${todo.length})` : ""}${args.dryRun ? " — DRY RUN" : ""}`);

  let updated = 0;
  let noImage = 0;
  for (const r of todo) {
    const title = r.data?.title ?? r.id;
    process.stdout.write(`• ${title} … `);

    if (args.dryRun) {
      // Don't spend AI calls or upload in a dry run; just check for a free page candidate.
      const pageOnly = await findCandidate(r.data, r.source_url, false);
      console.log(pageOnly ? "page image found (would re-host)" : allowAi ? "no page image (would try AI)" : "no page image");
      continue;
    }

    const candidate = await findCandidate(r.data, r.source_url, allowAi);
    if (!candidate) {
      console.log("no image found");
      noImage++;
      continue;
    }
    const img = await downloadImage(candidate);
    if (!img) {
      console.log("image download failed");
      noImage++;
      continue;
    }
    const hosted = await uploadRecipeImage(r.household_id, r.id, img.bytes, img.contentType, img.ext);
    if (!hosted) {
      console.log("upload failed");
      noImage++;
      continue;
    }
    const newData = { ...r.data, imageUrl: hosted, image_source: { page: candidate, note: "Backfilled image" } };
    const { error: upErr } = await db.from("user_recipes").update({ data: newData }).eq("id", r.id);
    if (upErr) {
      console.log(`row update failed: ${upErr.message}`);
      noImage++;
      continue;
    }
    console.log("✓ re-hosted");
    updated++;
  }

  if (!args.dryRun) console.log(`\n[backfill-images] updated ${updated}, no image for ${noImage}`);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

main().catch((e) => die(e?.message ?? String(e)));
