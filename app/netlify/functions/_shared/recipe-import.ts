// Pure, environment-neutral helpers for importing a recipe from a web page. No network or
// SDK deps here so this is unit-testable; recipe-import.ts (the handler) does the fetching
// and anthropic.ts does the Claude call. Types mirror app/src/lib/types.ts — kept local
// (like kroger.ts) so the functions don't reach across into the SPA source tree.

export type Category = "breakfast" | "lunch" | "dinner" | "snack";
export type PrepStyle = "no_cook" | "make_ahead" | "cook";
export type Section =
  | "Produce"
  | "Meat & Poultry"
  | "Dairy & Eggs"
  | "Frozen"
  | "Bakery"
  | "Canned Goods (Soups, vegetables, and pasta sauces, etc.)"
  | "Pantry & Dry Goods"
  | "Condiments & Spices";

export const SECTIONS: Section[] = [
  "Produce",
  "Meat & Poultry",
  "Dairy & Eggs",
  "Frozen",
  "Bakery",
  "Canned Goods (Soups, vegetables, and pasta sauces, etc.)",
  "Pantry & Dry Goods",
  "Condiments & Spices",
];

export interface Nutrition {
  kcal: number;
  carb_g: number;
  fiber_g: number;
  protein_g: number;
  fat_g: number;
}

export interface ParsedIngredient {
  qty: number | null;
  unit: string;
  item: string;
  section?: Section;
  optional?: boolean;
  note?: string;
}

/** The intermediate shape both the JSON-LD parser and Claude produce. */
export interface ParsedRecipe {
  title: string;
  category?: Category;
  cuisine?: string | null;
  servings?: number;
  prep_minutes?: number;
  cook_minutes?: number;
  ingredients: ParsedIngredient[];
  method?: string;
  notes?: string;
  nutrition?: Partial<Nutrition>;
}

// The full Recipe shape the SPA consumes (mirror of app/src/lib/types.ts Recipe).
export interface DraftIngredient {
  qty: number | null;
  unit: string;
  item: string;
  section: Section;
  perishable: boolean;
  staple: boolean;
  optional?: boolean;
  note?: string;
}
export interface DraftRecipe {
  id: string;
  title: string;
  category: Category;
  cuisine: string | null;
  servings: number;
  prep_minutes?: number;
  cook_minutes?: number;
  prep_style: PrepStyle;
  tags: string[];
  nutrition_per_serving: Nutrition;
  nutrition_estimated: boolean;
  source?: { name?: string; url?: string; note?: string };
  imageUrl: string | null;
  ingredients: DraftIngredient[];
  method: string;
  notes: string;
  method_is_link_only: boolean;
}

const ZERO_NUTRITION: Nutrition = { kcal: 0, carb_g: 0, fiber_g: 0, protein_g: 0, fat_g: 0 };

// ---- URL safety (SSRF guard) ---------------------------------------------------------

/** Only allow plain http(s) URLs to public hosts. Blocks localhost, *.local, and obvious
 *  private/link-local/loopback literals so the server can't be coaxed into fetching
 *  internal endpoints. (DNS-rebinding is out of scope for a single-family app, but the
 *  literal checks cover the easy cases.) */
export function isSafeImportUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return false;
  // IPv4 literal in a private/loopback/link-local range
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false; // link-local (incl. cloud metadata 169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return false;
  }
  return true;
}

// ---- HTML → text + JSON-LD extraction ------------------------------------------------

/** Strip tags/scripts to plain text for the Claude fallback (keep it small). */
export function htmlToText(html: string, maxChars = 18000): string {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Collect every JSON-LD object on the page (handles @graph and arrays). */
function jsonLdNodes(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let parsed: any;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue; // some sites emit invalid JSON-LD; skip it
    }
    const stack = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) stack.push(...node);
      else if (node && typeof node === "object") {
        out.push(node);
        if (Array.isArray(node["@graph"])) stack.push(...node["@graph"]);
      }
    }
  }
  return out;
}

function isRecipeType(t: any): boolean {
  if (!t) return false;
  return Array.isArray(t) ? t.some((x) => String(x).toLowerCase().endsWith("recipe")) : String(t).toLowerCase().endsWith("recipe");
}

/** ISO-8601 duration (e.g. "PT1H30M") → whole minutes, or undefined. */
export function parseDuration(iso: any): number | undefined {
  if (typeof iso !== "string") return undefined;
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return undefined;
  const mins = (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
  return mins > 0 ? mins : undefined;
}

/** recipeYield can be a number, "4 servings", or ["4 servings", "4"]. */
export function parseYield(y: any): number | undefined {
  const val = Array.isArray(y) ? y.find((v) => v != null) : y;
  if (typeof val === "number" && val > 0) return Math.round(val);
  const m = String(val ?? "").match(/\d+/);
  return m ? Number(m[0]) : undefined;
}

function instructionText(instr: any): string {
  if (typeof instr === "string") return instr.replace(/<[^>]+>/g, " ").trim();
  if (Array.isArray(instr)) {
    const steps: string[] = [];
    for (const s of instr) {
      if (typeof s === "string") steps.push(s.trim());
      else if (s?.["@type"] === "HowToSection" && Array.isArray(s.itemListElement)) {
        if (s.name) steps.push(`\n${s.name}`);
        for (const st of s.itemListElement) if (st?.text) steps.push(st.text.trim());
      } else if (s?.text) steps.push(String(s.text).trim());
    }
    return steps
      .map((t, i) => (t.startsWith("\n") ? t.trim() : `${i + 1}. ${t}`))
      .join("\n");
  }
  return "";
}

/** Pull the first schema.org Recipe out of a page's JSON-LD, or null if none. */
export function extractJsonLdRecipe(html: string): ParsedRecipe | null {
  const node = jsonLdNodes(html).find((n) => isRecipeType(n["@type"]));
  if (!node) return null;
  const ingredients = (node.recipeIngredient ?? node.ingredients ?? [])
    .map((s: any) => String(s).trim())
    .filter(Boolean)
    .map(parseIngredientLine);
  if (!ingredients.length) return null; // a Recipe node with no ingredients isn't useful

  const nutrition: Partial<Nutrition> = {};
  const n = node.nutrition;
  if (n && typeof n === "object") {
    const num = (v: any) => {
      const m = String(v ?? "").match(/[\d.]+/);
      return m ? Number(m[0]) : undefined;
    };
    if (num(n.calories) != null) nutrition.kcal = num(n.calories);
    if (num(n.carbohydrateContent) != null) nutrition.carb_g = num(n.carbohydrateContent);
    if (num(n.fiberContent) != null) nutrition.fiber_g = num(n.fiberContent);
    if (num(n.proteinContent) != null) nutrition.protein_g = num(n.proteinContent);
    if (num(n.fatContent) != null) nutrition.fat_g = num(n.fatContent);
  }

  const cuisine = Array.isArray(node.recipeCuisine) ? node.recipeCuisine[0] : node.recipeCuisine;
  return {
    title: String(node.name ?? "").trim() || "Imported recipe",
    cuisine: cuisine ? String(cuisine) : null,
    category: mapCategory(node.recipeCategory),
    servings: parseYield(node.recipeYield),
    prep_minutes: parseDuration(node.prepTime),
    cook_minutes: parseDuration(node.cookTime),
    ingredients,
    method: instructionText(node.recipeInstructions),
    nutrition,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function mapCategory(c: unknown): Category | undefined {
  const s = String(Array.isArray(c) ? c[0] : c ?? "").toLowerCase();
  if (/break|brunch/.test(s)) return "breakfast";
  if (/lunch/.test(s)) return "lunch";
  if (/snack|appetiz|dessert|side/.test(s)) return "snack";
  if (/dinner|main|entr/.test(s)) return "dinner";
  return undefined;
}

// ---- Ingredient line parsing ---------------------------------------------------------

const UNICODE_FRACTIONS: Record<string, number> = {
  "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3,
  "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};

const UNITS = new Set([
  "cup", "cups", "tablespoon", "tablespoons", "tbsp", "teaspoon", "teaspoons", "tsp",
  "ounce", "ounces", "oz", "pound", "pounds", "lb", "lbs", "gram", "grams", "g", "kg",
  "ml", "milliliter", "milliliters", "liter", "liters", "l", "pinch", "pinches", "dash",
  "clove", "cloves", "can", "cans", "package", "packages", "pkg", "slice", "slices",
  "stick", "sticks", "quart", "quarts", "pint", "pints", "gallon", "head", "heads",
  "bunch", "bunches", "sprig", "sprigs", "stalk", "stalks", "piece", "pieces",
]);

/** Parse a free-text ingredient line ("2 ½ cups all-purpose flour, sifted") into
 *  qty / unit / item (+ note after a comma). Best-effort; the user can correct it. */
export function parseIngredientLine(line: string): ParsedIngredient {
  let rest = line.trim().replace(/\s+/g, " ");
  // split a trailing prep note ("…, finely chopped")
  let note: string | undefined;
  const comma = rest.indexOf(",");
  if (comma >= 0) {
    note = rest.slice(comma + 1).trim() || undefined;
    rest = rest.slice(0, comma).trim();
  }

  // leading quantity: integer, decimal, fraction "1/2", mixed "1 1/2", or unicode fraction
  let qty: number | null = null;
  const qtyRe = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])\s*/;
  const qm = rest.match(qtyRe);
  if (qm) {
    qty = parseQty(qm[1]);
    rest = rest.slice(qm[0].length);
    // a second unicode/【fraction part, e.g. "2 ½"
    const qm2 = rest.match(/^([¼½¾⅓⅔⅛⅜⅝⅞])\s*/);
    if (qm2 && qty != null) {
      qty += UNICODE_FRACTIONS[qm2[1]];
      rest = rest.slice(qm2[0].length);
    }
  }

  let unit = "each";
  const first = rest.split(" ")[0]?.toLowerCase().replace(/\.$/, "");
  if (first && UNITS.has(first)) {
    unit = first;
    rest = rest.slice(rest.split(" ")[0].length).trim();
  }

  const item = rest.trim() || line.trim();
  return { qty, unit, item, section: guessSection(item), note };
}

function parseQty(s: string): number {
  s = s.trim();
  if (UNICODE_FRACTIONS[s] != null) return UNICODE_FRACTIONS[s];
  if (s.includes(" ")) {
    const [whole, frac] = s.split(" ");
    return Number(whole) + parseQty(frac);
  }
  if (s.includes("/")) {
    const [a, b] = s.split("/").map(Number);
    return b ? a / b : Number(a);
  }
  return Number(s);
}

// ---- Section guessing ----------------------------------------------------------------

const SECTION_KEYWORDS: [Section, RegExp][] = [
  ["Produce", /\b(onion|garlic|tomato|potato|carrot|celery|pepper|lettuce|spinach|kale|arugula|cucumber|zucchini|eggplant|broccoli|cauliflower|mushroom|lemon|lime|orange|apple|banana|berry|berries|avocado|ginger|cilantro|parsley|basil|mint|herb|scallion|green onion|leek|cabbage|squash|corn|bean sprout|lettuce|greens|chili pepper|jalapeno|fresh)s?\b/],
  ["Meat & Poultry", /\b(chicken|beef|pork|turkey|lamb|bacon|sausage|steak|ground (beef|pork|turkey)|ham|veal|chorizo|prosciutto)s?\b/],
  ["Dairy & Eggs", /\b(milk|butter|cheese|cream|yogurt|egg|eggs|sour cream|half-and-half|buttermilk|mozzarella|parmesan|cheddar|feta|ricotta)s?\b/],
  ["Frozen", /\b(frozen|ice cream|frozen peas|frozen corn)s?\b/],
  ["Bakery", /\b(bread|baguette|bun|buns|roll|rolls|tortilla|pita|naan|bagel|croissant)s?\b/],
  ["Canned Goods (Soups, vegetables, and pasta sauces, etc.)", /\b(canned|can of|broth|stock|coconut milk|tomato sauce|tomato paste|crushed tomato|diced tomato|pasta sauce|marinara|beans?\b.*\bcan|chickpea|black bean|kidney bean)s?\b/],
  ["Condiments & Spices", /\b(salt|pepper|cumin|paprika|cinnamon|nutmeg|oregano|thyme|rosemary|bay leaf|curry|chili powder|cayenne|turmeric|coriander|spice|soy sauce|fish sauce|vinegar|mustard|ketchup|mayonnaise|hot sauce|sriracha|worcestershire|honey|maple syrup|sesame oil|olive oil|vegetable oil)s?\b/],
  ["Pantry & Dry Goods", /\b(flour|sugar|rice|pasta|noodle|oat|oats|quinoa|lentil|cornstarch|baking powder|baking soda|yeast|vanilla|cocoa|chocolate chip|breadcrumb|cracker|cereal|peanut butter|nut|nuts|seed|raisin|stock cube|bouillon)s?\b/],
];

/** Best-effort store section for a free-text ingredient name; defaults to pantry. */
export function guessSection(item: string): Section {
  const s = item.toLowerCase();
  for (const [section, re] of SECTION_KEYWORDS) if (re.test(s)) return section;
  return "Pantry & Dry Goods";
}

// ---- Finalize: ParsedRecipe → DraftRecipe --------------------------------------------

const PERISHABLE_SECTIONS = new Set<Section>(["Produce", "Meat & Poultry", "Dairy & Eggs", "Frozen", "Bakery"]);

/** Turn the parsed/extracted recipe into a complete Recipe the SPA can store and display.
 *  Fills ids, sections, perishable flags, and defaults nutrition (flagged estimated when
 *  the source had none). The user reviews/edits this before saving. */
export function toDraftRecipe(
  parsed: ParsedRecipe,
  sourceUrl: string,
  idFactory: () => string = randomId
): DraftRecipe {
  const ingredients: DraftIngredient[] = parsed.ingredients
    .filter((i) => i.item?.trim())
    .map((i) => {
      const section = i.section && SECTIONS.includes(i.section) ? i.section : guessSection(i.item);
      return {
        qty: i.qty ?? null,
        unit: i.unit || "each",
        item: i.item.trim(),
        section,
        perishable: PERISHABLE_SECTIONS.has(section),
        staple: false,
        ...(i.optional ? { optional: true } : {}),
        ...(i.note ? { note: i.note } : {}),
      };
    });

  const nut = parsed.nutrition ?? {};
  const hasNutrition = ["kcal", "carb_g", "fiber_g", "protein_g", "fat_g"].some(
    (k) => typeof (nut as Record<string, unknown>)[k] === "number"
  );
  const nutrition: Nutrition = {
    kcal: nut.kcal ?? 0,
    carb_g: nut.carb_g ?? 0,
    fiber_g: nut.fiber_g ?? 0,
    protein_g: nut.protein_g ?? 0,
    fat_g: nut.fat_g ?? 0,
  };

  let host = "";
  try {
    host = new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    /* sourceUrl already validated upstream; ignore */
  }

  return {
    id: idFactory(),
    title: parsed.title?.trim() || "Imported recipe",
    category: parsed.category ?? "dinner",
    cuisine: parsed.cuisine ?? null,
    servings: parsed.servings && parsed.servings > 0 ? parsed.servings : 4,
    ...(parsed.prep_minutes ? { prep_minutes: parsed.prep_minutes } : {}),
    ...(parsed.cook_minutes ? { cook_minutes: parsed.cook_minutes } : {}),
    prep_style: "cook",
    tags: ["imported"],
    nutrition_per_serving: hasNutrition ? nutrition : ZERO_NUTRITION,
    nutrition_estimated: !hasNutrition,
    source: { url: sourceUrl, ...(host ? { name: host } : {}) },
    imageUrl: null, // remote images aren't re-hosted (CSP); the user can't load arbitrary hosts
    ingredients,
    method: parsed.method?.trim() || "",
    notes: parsed.notes?.trim() || "",
    method_is_link_only: !parsed.method?.trim(),
  };
}

/** Recipe id for imported recipes — a "u-" prefixed uuid so they're distinguishable from
 *  bundled ids and never collide with them. */
export function randomId(): string {
  return "u-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
}

// ---- Rate limiting (per household; protects the Anthropic spend + fetch abuse) --------

/** Decide whether another import is allowed given the timestamps (ms) of recent import
 *  events. Pure so the I/O wrapper in supa.ts stays thin and this stays testable.
 *  `retryAfterSec` is how long until the oldest in-window event ages out (0 when allowed). */
export function importRateDecision(
  recentMs: number[],
  nowMs: number,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const inWindow = recentMs.filter((t) => Number.isFinite(t) && nowMs - t < windowMs);
  if (inWindow.length < limit) return { allowed: true, retryAfterSec: 0 };
  const oldest = Math.min(...inWindow);
  const retryAfterSec = Math.max(1, Math.ceil((windowMs - (nowMs - oldest)) / 1000));
  return { allowed: false, retryAfterSec };
}
