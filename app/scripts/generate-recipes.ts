// Maintainer generator: ask Claude for ultra-simple, diabetic, net-carb-bounded recipes
// that reuse a shared palette, finalize them into the app's Recipe shape, validate against
// the constraints, and emit reviewed recipes (JSON) + a report to commit. Optionally push
// the kept recipes straight into a household's user_recipes table — the "generate → review
// the diff → fold into the curated set" loop.
//
//   npm run generate:recipes -- --role breakfast --count 6 --max-net-carbs 12 --max-ingredients 5
//   npm run generate:recipes -- --role lunch --palette "chicken breast,romaine,cucumber,feta,olive oil"
//   npm run generate:recipes -- --role dinner --no-fish --push --household <uuid>
//
// Env: ANTHROPIC_API_KEY (required), SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (only for --push).
//
// Reuses the exact pure helpers + Claude call the app would use, so behavior matches.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  toGeneratedDraft,
  validateGenerated,
  netCarbsOf,
  type GenConstraints,
  type GeneratedDraft,
} from "../netlify/functions/_shared/recipe-generate";
import { generateRecipesWithClaude, hasClaude } from "../netlify/functions/_shared/anthropic";
import type { Category } from "../netlify/functions/_shared/recipe-import";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROLES: Category[] = ["breakfast", "lunch", "dinner", "snack"];

interface Args extends GenConstraints {
  out: string;
  push: boolean;
  household: string | null;
  keepInvalid: boolean;
}

function die(msg: string): never {
  console.error(`[generate-recipes] ${msg}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    count: 6,
    role: "breakfast",
    maxIngredients: 6,
    maxNetCarbs: 15,
    palette: [],
    noFish: false,
    servings: 2,
    out: path.join(__dirname, "out"),
    push: false,
    household: null,
    keepInvalid: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--count") a.count = Math.max(1, Number(argv[++i]) || 1);
    else if (v === "--role") {
      const r = argv[++i] as Category;
      if (!ROLES.includes(r)) die(`--role must be one of ${ROLES.join(", ")}`);
      a.role = r;
    } else if (v === "--max-ingredients") a.maxIngredients = Math.max(1, Number(argv[++i]) || 6);
    else if (v === "--max-net-carbs") a.maxNetCarbs = Math.max(0, Number(argv[++i]) || 0);
    else if (v === "--palette") a.palette = String(argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (v === "--servings") a.servings = Math.max(1, Number(argv[++i]) || 2);
    else if (v === "--no-fish") a.noFish = true;
    else if (v === "--out") a.out = path.resolve(argv[++i]);
    else if (v === "--push") a.push = true;
    else if (v === "--household") a.household = argv[++i];
    else if (v === "--keep-invalid") a.keepInvalid = true;
    else die(`unknown flag: ${v}`);
  }
  return a;
}

function recipeReport(d: GeneratedDraft, reasons: string[]): string {
  const shoppable = d.ingredients.filter((i) => !i.staple).length;
  const net = netCarbsOf(d.nutrition_per_serving);
  const status = reasons.length ? `⚠ ${reasons.join("; ")}` : "ok";
  const items = d.ingredients.map((i) => i.item).join(", ");
  return [
    `## ${d.title} — ${status}`,
    `- ${shoppable} shoppable ingredients · ~${net}g net carbs · ${d.prep_style}` +
      `${d.office_friendly ? " · office-friendly" : ""}${d.batch ? " · batch" : ""}`,
    `- ingredients: ${items}`,
    "",
  ].join("\n");
}

async function pushToHousehold(recipes: GeneratedDraft[], householdId: string): Promise<void> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) die("--push needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows = recipes.map((r) => ({ id: r.id, household_id: householdId, data: r, source_url: null }));
  const { error } = await db.from("user_recipes").upsert(rows, { onConflict: "id" });
  if (error) die(`push failed: ${error.message}`);
  console.log(`[generate-recipes] pushed ${rows.length} recipe(s) to household ${householdId}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!hasClaude(process.env)) die("ANTHROPIC_API_KEY is required to generate recipes");

  console.log(
    `[generate-recipes] ${args.count} ${args.role}(s), ≤${args.maxIngredients} ingredients, ≤${args.maxNetCarbs}g net carbs` +
      `${args.palette?.length ? `, palette: ${args.palette.join(", ")}` : ""}`
  );

  const generated = await generateRecipesWithClaude(process.env, args);
  const drafts = generated.map((g) => toGeneratedDraft(g, args));

  const kept: GeneratedDraft[] = [];
  const reportParts: string[] = [`# Generated recipes report`, `Generated ${new Date().toISOString()}`, ""];
  for (const d of drafts) {
    const reasons = validateGenerated(d, args);
    reportParts.push(recipeReport(d, reasons));
    if (!reasons.length || args.keepInvalid) kept.push(d);
    console.log(`  • ${d.title} — ${reasons.length ? `⚠ ${reasons.join("; ")}` : "ok"}`);
  }

  fs.mkdirSync(args.out, { recursive: true });
  const jsonPath = path.join(args.out, "generated-recipes.json");
  const reportPath = path.join(args.out, "generated-report.md");
  fs.writeFileSync(jsonPath, JSON.stringify(kept, null, 2));
  fs.writeFileSync(reportPath, reportParts.join("\n"));
  console.log(`\n[generate-recipes] ${kept.length}/${drafts.length} kept → ${jsonPath}\n[generate-recipes] report → ${reportPath}`);

  if (args.push) {
    if (!args.household) die("--push requires --household <uuid>");
    if (!kept.length) die("nothing to push");
    await pushToHousehold(kept, args.household);
  }
}

main().catch((e) => die(e?.message ?? String(e)));
