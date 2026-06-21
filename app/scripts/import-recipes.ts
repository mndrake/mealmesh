// Maintainer batch importer: scrape + parse + Kroger-verify a list of recipe URLs, then
// emit reviewed recipes (JSON) + a human-readable report to commit. Optionally push the
// verified recipes straight into a household's user_recipes table.
//
//   npm run import:recipes -- --urls urls.txt --location 01400943
//   npm run import:recipes -- https://site/r1 https://site/r2 --no-ai
//   npm run import:recipes -- --urls urls.txt --push --household <uuid>
//
// Env: ANTHROPIC_API_KEY (AI fallback), KROGER_CLIENT_ID/SECRET (verification),
//      SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (--push). All optional except as noted.
//
// Reuses the same pure helpers as the runtime importer so behavior matches the app.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isSafeImportUrl,
  htmlToText,
  extractJsonLdRecipe,
  toDraftRecipe,
  type DraftRecipe,
  type ParsedRecipe,
} from "../netlify/functions/_shared/recipe-import";
import { extractRecipeWithClaude, extractRecipeViaWebFetch, hasClaude } from "../netlify/functions/_shared/anthropic";
import { toReviewRow, type ProductMatch } from "../netlify/functions/_shared/kroger";
import { clientCredToken, searchProducts } from "../netlify/functions/_shared/kroger-api";
import { krogerDepartmentToSection } from "../src/lib/krogerSections";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- args -----------------------------------------------------------------------------
interface Args {
  urls: string[];
  location: string | null;
  out: string;
  ai: boolean;
  push: boolean;
  household: string | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { urls: [], location: null, out: path.join(__dirname, "out"), ai: true, push: false, household: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--urls") a.urls.push(...readUrlFile(argv[++i]));
    else if (v === "--location") a.location = argv[++i];
    else if (v === "--out") a.out = path.resolve(argv[++i]);
    else if (v === "--no-ai") a.ai = false;
    else if (v === "--push") a.push = true;
    else if (v === "--household") a.household = argv[++i];
    else if (v.startsWith("--")) die(`unknown flag: ${v}`);
    else a.urls.push(v);
  }
  return a;
}

function readUrlFile(file: string): string[] {
  if (!file || !fs.existsSync(file)) die(`--urls file not found: ${file}`);
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function die(msg: string): never {
  console.error(`\n[import-recipes] ${msg}\n`);
  process.exit(1);
}

// ---- scrape + parse (mirrors the runtime handler) -------------------------------------
const FETCH_TIMEOUT_MS = 12_000;

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
    const ct = res.headers.get("content-type") || "";
    if (!/html|xml|text/i.test(ct)) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function importOne(url: string, ai: boolean): Promise<{ recipe: DraftRecipe; via: string } | { error: string }> {
  if (!isSafeImportUrl(url)) return { error: "bad_url" };
  const html = await fetchPage(url);

  if (html) {
    const jsonLd = extractJsonLdRecipe(html);
    if (jsonLd) return { recipe: toDraftRecipe(jsonLd, url), via: "jsonld" };
  }
  if (!ai || !hasClaude(process.env)) return { error: html ? "no_structured_data" : "fetch_failed" };

  let parsed: ParsedRecipe;
  try {
    parsed = html ? await extractRecipeWithClaude(process.env, htmlToText(html), url) : await extractRecipeViaWebFetch(process.env, url);
  } catch (e) {
    return { error: `ai_failed: ${(e as Error).message}` };
  }
  if (!parsed.ingredients?.length) return { error: "no_recipe" };
  return { recipe: toDraftRecipe(parsed, url), via: html ? "ai" : "ai_fetch" };
}

// ---- Kroger verification --------------------------------------------------------------
type IngStatus = "available" | "unavailable" | "no_match" | "skipped";
interface IngReport {
  item: string;
  status: IngStatus;
  product: string | null;
  section: string;
}

/** Verify one ingredient against a Kroger match; annotate the draft in place (buy_as +
 *  confident section) and return a report row. Pure given the match. */
function verifyIngredient(ing: DraftRecipe["ingredients"][number], match: ProductMatch | null): IngReport {
  if (!match) return { item: ing.item, status: "no_match", product: null, section: ing.section };
  const status: IngStatus = match.available ? "available" : "unavailable";
  if (match.available) {
    if (match.description && match.description.toLowerCase() !== ing.item.toLowerCase()) ing.buy_as = match.description;
    const sec = krogerDepartmentToSection(match.department);
    if (sec) {
      ing.section = sec;
      ing.perishable = ["Produce", "Meat & Poultry", "Dairy & Eggs", "Frozen", "Bakery"].includes(sec);
    }
  }
  return { item: ing.item, status, product: match.description || null, section: ing.section };
}

async function verifyRecipe(
  recipe: DraftRecipe,
  token: string,
  locationId: string,
  cache: Map<string, ProductMatch | null>
): Promise<IngReport[]> {
  const reports: IngReport[] = [];
  for (const ing of recipe.ingredients) {
    const term = (ing.buy_as || ing.item).trim();
    let match = cache.get(term);
    if (match === undefined) {
      const row = toReviewRow(await searchProducts(process.env, token, term, locationId), term, "");
      match = row.matched;
      cache.set(term, match);
    }
    reports.push(verifyIngredient(ing, match));
  }
  return reports;
}

// ---- report + output ------------------------------------------------------------------
const STATUS_MARK: Record<IngStatus, string> = { available: "✓", unavailable: "⚠", no_match: "✗", skipped: "·" };

function recipeReport(recipe: DraftRecipe, via: string, ings: IngReport[]): string {
  const lines = [`## ${recipe.title}`, ``, `- Source: ${recipe.source?.url ?? "—"} (${via})`, `- Serves ${recipe.servings} · ${recipe.category}`, ``];
  if (ings.length) {
    lines.push(`| | Ingredient | Kroger product | Section |`, `|---|---|---|---|`);
    for (const r of ings) lines.push(`| ${STATUS_MARK[r.status]} | ${r.item} | ${r.product ?? "—"} | ${r.section} |`);
    const miss = ings.filter((r) => r.status === "no_match" || r.status === "unavailable").length;
    lines.push(``, miss ? `**${miss} ingredient(s) need attention.**` : `All ingredients matched & available. ✓`, ``);
  }
  return lines.join("\n");
}

// ---- Supabase push (optional) ---------------------------------------------------------
async function pushToHousehold(recipes: DraftRecipe[], householdId: string): Promise<void> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) die("--push needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows = recipes.map((r) => ({ id: r.id, household_id: householdId, data: r, source_url: r.source?.url ?? null }));
  const { error } = await db.from("user_recipes").upsert(rows, { onConflict: "id" });
  if (error) die(`push failed: ${error.message}`);
  console.log(`[import-recipes] pushed ${rows.length} recipe(s) to household ${householdId}`);
}

// ---- main -----------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.urls.length) die("no URLs given (pass URLs or --urls <file>)");

  const doVerify = Boolean(args.location && process.env.KROGER_CLIENT_ID && process.env.KROGER_CLIENT_SECRET);
  if (args.location && !doVerify) console.warn("[import-recipes] --location set but KROGER_CLIENT_ID/SECRET missing; skipping verification");
  const token = doVerify ? await clientCredToken(process.env) : null;
  const matchCache = new Map<string, ProductMatch | null>();

  const recipes: DraftRecipe[] = [];
  const reportParts: string[] = [`# Recipe import report`, `Generated ${new Date().toISOString()}`, ``];
  const failures: string[] = [];

  for (const url of args.urls) {
    process.stdout.write(`• ${url} … `);
    const res = await importOne(url, args.ai);
    if ("error" in res) {
      console.log(`FAILED (${res.error})`);
      failures.push(`- ${url} — ${res.error}`);
      continue;
    }
    const ings = token && args.location ? await verifyRecipe(res.recipe, token, args.location, matchCache) : [];
    console.log(`ok (${res.via}${ings.length ? `, ${ings.filter((r) => r.status === "available").length}/${ings.length} available` : ""})`);
    recipes.push(res.recipe);
    reportParts.push(recipeReport(res.recipe, res.via, ings));
  }

  if (failures.length) reportParts.push(`## Failed`, ``, ...failures, ``);

  fs.mkdirSync(args.out, { recursive: true });
  const jsonPath = path.join(args.out, "imported-recipes.json");
  const reportPath = path.join(args.out, "import-report.md");
  fs.writeFileSync(jsonPath, JSON.stringify(recipes, null, 2));
  fs.writeFileSync(reportPath, reportParts.join("\n"));
  console.log(`\n[import-recipes] ${recipes.length} recipe(s) → ${jsonPath}\n[import-recipes] report → ${reportPath}`);

  if (args.push) {
    if (!args.household) die("--push requires --household <uuid>");
    if (!recipes.length) die("nothing to push");
    await pushToHousehold(recipes, args.household);
  }
}

main().catch((e) => die(e?.message ?? String(e)));
