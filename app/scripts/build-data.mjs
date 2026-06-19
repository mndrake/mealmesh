// Build-time data layer: parse every recipe-repo/*.md, validate against the
// JSON schema, normalize UI fields, split method/notes, and emit one JSON bundle
// + copy images into public/. Fails loudly so bad data can't reach the app.
//
//   node scripts/build-data.mjs
//
// recipe-repo/ is READ-ONLY: this script only reads from it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import Ajv from "ajv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.dirname(__dirname);
const ROOT = path.dirname(APP);
const REPO = path.join(ROOT, "recipe-repo");
const RECIPES_DIR = path.join(REPO, "recipes");
const SCHEMA_PATH = path.join(REPO, "schema", "recipe.json");

const OUT_DATA = path.join(APP, "src", "data");
const OUT_IMAGES = path.join(APP, "public", "recipe-images");

function die(msg) {
  console.error("\n[build-data] FAILED: " + msg + "\n");
  process.exit(1);
}

// Recursively collect .md files, then sort by full path string to match the
// Python loader's `sorted(glob(...))` — planner/shopping parity depends on this order.
function findRecipeFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findRecipeFiles(p));
    else if (entry.name.endsWith(".md")) out.push(p);
  }
  return out;
}

// Split the markdown body into method + notes. Method lives under
// "## Method" or "## Instructions"; notes under "## Notes".
function splitBody(body) {
  const sections = {};
  let current = null;
  for (const line of body.split("\n")) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      current = h[1].toLowerCase();
      sections[current] = [];
    } else if (current) {
      sections[current].push(line);
    }
  }
  const get = (k) => (sections[k] ? sections[k].join("\n").trim() : "");
  const method = get("method") || get("instructions") || "";
  const notes = get("notes");
  const methodIsLinkOnly =
    /see the full step-by-step method at the source/i.test(method) ||
    (method !== "" && /^\s*(see|view).*source/i.test(method) && method.length < 200);
  return { method, notes, methodIsLinkOnly };
}

function main() {
  if (!fs.existsSync(REPO)) die(`recipe-repo not found at ${REPO}`);
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  const files = findRecipeFiles(RECIPES_DIR).sort();
  if (files.length === 0) die("no recipe files found");

  const recipes = [];
  const seenIds = new Set();
  const errors = [];

  for (const file of files) {
    const rel = path.relative(REPO, file);
    let fm, body;
    try {
      const parsed = matter(fs.readFileSync(file, "utf8"));
      fm = parsed.data;
      body = parsed.content;
    } catch (e) {
      errors.push(`${rel}: frontmatter parse error: ${e.message}`);
      continue;
    }

    if (!validate(fm)) {
      const msg = (validate.errors || [])
        .map((e) => `${e.instancePath || "/"} ${e.message}`)
        .join("; ");
      errors.push(`${rel}: schema validation failed: ${msg}`);
      continue;
    }
    if (seenIds.has(fm.id)) {
      errors.push(`${rel}: duplicate id "${fm.id}"`);
      continue;
    }
    seenIds.add(fm.id);

    const { method, notes, methodIsLinkOnly } = splitBody(body);

    // Normalize the two UI-critical fields the schema permits but does not require.
    const cuisine =
      typeof fm.cuisine === "string" && fm.cuisine.trim() ? fm.cuisine.trim() : null;
    const nutrition_estimated = fm.nutrition_estimated === true;

    recipes.push({
      id: fm.id,
      title: fm.title,
      category: fm.category,
      cuisine,
      servings: fm.servings,
      serving_size: fm.serving_size,
      prep_minutes: fm.prep_minutes ?? 0,
      cook_minutes: fm.cook_minutes ?? 0,
      prep_style: fm.prep_style,
      office_friendly: !!fm.office_friendly,
      batch: !!fm.batch,
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      nutrition_per_serving: fm.nutrition_per_serving,
      nutrition_estimated,
      source: fm.source ?? undefined,
      image: fm.image,
      image_source: fm.image_source ?? undefined,
      ingredients: (fm.ingredients ?? []).map((i) => ({
        qty: i.qty ?? null,
        unit: i.unit ?? "",
        item: i.item,
        section: i.section,
        perishable: !!i.perishable,
        staple: !!i.staple,
        ...(i.buy_as ? { buy_as: i.buy_as } : {}),
        ...(i.exclude_from_shopping ? { exclude_from_shopping: true } : {}),
        ...(i.optional ? { optional: true } : {}),
        ...(i.note ? { note: i.note } : {}),
      })),
      method,
      notes,
      method_is_link_only: methodIsLinkOnly,
    });
  }

  if (errors.length) {
    die(`${errors.length} recipe(s) invalid:\n  - ` + errors.join("\n  - "));
  }

  // Copy images by the recipe's `image` field (falls back to <id>.jpg), renaming
  // to <id>.jpg in public/ so the app can reference a single stable path per recipe.
  // recipe-repo/images/ is read-only; we only read from it.
  fs.rmSync(OUT_IMAGES, { recursive: true, force: true });
  fs.mkdirSync(OUT_IMAGES, { recursive: true });
  let copied = 0;
  for (const r of recipes) {
    const candidates = [
      r.image ? path.join(REPO, r.image) : null,
      path.join(REPO, "images", `${r.id}.jpg`),
    ].filter(Boolean);
    const src = candidates.find((p) => fs.existsSync(p));
    if (src) {
      fs.copyFileSync(src, path.join(OUT_IMAGES, `${r.id}.jpg`));
      r.imageUrl = `/recipe-images/${r.id}.jpg`;
      copied++;
    } else {
      r.imageUrl = null;
    }
  }

  fs.mkdirSync(OUT_DATA, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DATA, "recipes.json"),
    JSON.stringify(recipes, null, 0) + "\n"
  );

  const byCat = recipes.reduce((m, r) => ((m[r.category] = (m[r.category] || 0) + 1), m), {});
  const est = recipes.filter((r) => r.nutrition_estimated).length;
  console.log(
    `[build-data] ${recipes.length} recipes -> src/data/recipes.json ` +
      `(${JSON.stringify(byCat)}); ${est} estimated nutrition; ${copied} images copied.`
  );
}

main();
