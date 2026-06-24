// Ingredient normalization layer.
//
// recipe-repo/ is a READ-ONLY, upstream-synced dataset, so we cannot fix
// mislabeled ingredients at the source (edits would be clobbered on re-sync).
// Instead we keep an explicit override table here and apply it as a pure
// pre-transform over recipes. Two passes:
//
//   • normalizeForDisplay — fixes wrong ITEM NAMES (e.g. "starch" -> "cornstarch")
//     and wrong store SECTIONS (e.g. "shallot" in Meat & Poultry -> Produce, frozen
//     produce -> Frozen). Applied everywhere the app shows a recipe.
//
//   • normalizeForShopping — additionally collapses prep-modified veg ("chopped red
//     bell pepper", measured in cups) into approximate WHOLE counts of the base item
//     ("red bell pepper", in `each`) so the shopping list doesn't carry both a
//     "chopped bell pepper" line and a "bell pepper" line. Recipe detail still shows
//     the prep wording; only the aggregated list is collapsed.
//
// The reference planner.py/shopping.py can never learn these renames (read-only), so
// the parity tests deliberately run on the RAW recipes — see recipes.ts.
import type { Ingredient, Recipe, Section } from "./types";
import { isStaple } from "./staples";

interface ItemOverride {
  /** Rename for BOTH display and shopping — use for genuine mislabels/typos. */
  item?: string;
  /** Correct grocery aisle (applies to display and shopping). */
  section?: Section;
  /** Shopping-only key: collapse into this base item without touching display. */
  buyItem?: string;
  /** Shopping-only unit conversion, applied when `unit === from`. Expresses a
   *  chopped/sliced volume as an approximate whole count (e.g. 1 cup ≈ 1 pepper). */
  convert?: { from: string; to: string; factor: number };
  /** Drop from the shopping list entirely — for non-grocery "ingredients"
   *  (water, ice) that are pantry/tap items, not things you buy. */
  exclude?: boolean;
}

// 1 cup chopped/sliced ≈ N whole units. Factors are deliberately rough — the goal
// is to avoid duplicate lines and give a buyable whole count, not exact yield.
const cupTo = (to: string, factor = 1) => ({ from: "cup", to, factor });

// Verbose label per request — defined once to avoid typos across the table.
const CANNED: Section = "Canned Goods (Soups, vegetables, and pasta sauces, etc.)";

const OVERRIDES: Record<string, ItemOverride> = {
  // ── US naming (British → US), so display + Kroger search use US product names.
  // Renamed to the canonical US name already used elsewhere in this table where one
  // exists (e.g. rocket → arugula) so duplicate lines merge. ──────────────────
  rocket: { item: "arugula", section: "Produce" },
  aubergine: { item: "eggplant", section: "Produce" },
  aubergines: { item: "eggplant", section: "Produce" },
  courgette: { item: "zucchini", section: "Produce" },
  courgettes: { item: "zucchini", section: "Produce" },
  coriander: { item: "fresh cilantro", section: "Produce" },
  "coriander leaves": { item: "fresh cilantro", section: "Produce" },
  "spring onions": { item: "green onions", section: "Produce" },
  "spring onion": { item: "green onions", section: "Produce" },
  beetroot: { item: "beets", section: "Produce" },
  swede: { item: "rutabaga", section: "Produce" },
  chilli: { item: "chili pepper", section: "Produce" },
  "red chilli": { item: "red chili pepper", section: "Produce" },
  "green chilli": { item: "green chili pepper", section: "Produce" },
  "birds-eye chillies": { item: "bird's eye chili", section: "Produce" },
  "dried chillies": { item: "dried chiles", section: "Condiments & Spices" },
  "chilli powder": { item: "chili powder", section: "Condiments & Spices" },
  "red chilli powder": { item: "red chili powder", section: "Condiments & Spices" },
  "chilli flakes": { item: "chili flakes", section: "Condiments & Spices" },
  "red chilli flakes": { item: "red chili flakes", section: "Condiments & Spices" },
  "chilli sauce": { item: "chili sauce", section: "Condiments & Spices" },
  "double cream": { item: "heavy cream", section: "Dairy & Eggs" },
  "single cream": { item: "light cream", section: "Dairy & Eggs" },
  "caster sugar": { item: "superfine sugar", section: "Pantry & Dry Goods" },
  "icing sugar": { item: "powdered sugar", section: "Pantry & Dry Goods" },
  "plain flour": { item: "all-purpose flour", section: "Pantry & Dry Goods" },
  "self-raising flour": { item: "self-rising flour", section: "Pantry & Dry Goods" },
  cornflour: { item: "cornstarch", section: "Pantry & Dry Goods" },
  "minced beef": { item: "ground beef", section: "Meat & Poultry" },
  "lean minced steak": { item: "lean ground beef", section: "Meat & Poultry" },
  "lamb mince": { item: "ground lamb", section: "Meat & Poultry" },
  "minced pork": { item: "ground pork", section: "Meat & Poultry" },
  prawns: { item: "shrimp", section: "Meat & Poultry" },
  prawn: { item: "shrimp", section: "Meat & Poultry" },

  // ── Mislabeled names (fixed in display + shopping) ──────────────────────────
  starch: { item: "cornstarch", section: "Pantry & Dry Goods" },
  "tinned tomatos": { item: "canned tomatoes", section: CANNED },
  "egg plants": { item: "eggplant", section: "Produce" },

  // ── Wrong section: spices/condiments mislabeled as Produce ──────────────────
  "baking powder": { section: "Pantry & Dry Goods" },
  "chili powder": { section: "Condiments & Spices" },
  "curry powder": { section: "Condiments & Spices" },
  "garlic powder": { section: "Condiments & Spices" },
  "onion powder": { section: "Condiments & Spices" },
  mayonnaise: { section: "Condiments & Spices" },
  capers: { section: "Condiments & Spices" },
  oil: { section: "Condiments & Spices" },
  cornstarch: { section: "Pantry & Dry Goods" },
  honey: { section: "Pantry & Dry Goods" },
  "rice vinegar": { section: "Condiments & Spices" },
  "tomato paste": { section: CANNED },
  vanilla: { section: "Pantry & Dry Goods" },
  "vanilla extract": { section: "Pantry & Dry Goods" },

  // ── Wrong section: fresh aromatics/herbs mislabeled as Condiments & Spices ───
  "fresh dill": { section: "Produce" },
  "fresh parsley": { section: "Produce" },
  "fresh ginger": { section: "Produce" },

  // ── Wrong section: items mislabeled as Meat & Poultry ───────────────────────
  "champagne vinegar": { section: "Condiments & Spices" },
  "fish sauce": { section: "Condiments & Spices" },
  "thai fish sauce": { section: "Condiments & Spices" },
  "goat cheese": { section: "Dairy & Eggs" },
  "goats cheese": { section: "Dairy & Eggs" },
  "minced apple": { section: "Produce" },
  // Fresh-garlic forms all collapse onto the dominant "garlic" shopping line so a plan
  // doesn't carry separate "garlic clove" / "garlic cloves" / "minced garlic" entries.
  "garlic clove": { section: "Produce", buyItem: "garlic" },
  "garlic cloves": { section: "Produce", buyItem: "garlic" },
  "minced garlic": { section: "Produce", buyItem: "garlic" },
  "crushed garlic": { section: "Produce", buyItem: "garlic" },
  "minced shallot": { section: "Produce", buyItem: "shallots" },
  "minced fresh parsley": { section: "Produce", buyItem: "fresh parsley" },

  // ── Wrong section: items mislabeled as Dairy & Eggs ─────────────────────────
  eggplant: { section: "Produce" },
  "egg noodles": { section: "Pantry & Dry Goods" },
  "cream of tartar": { section: "Pantry & Dry Goods" },
  "almond butter": { section: "Pantry & Dry Goods" },
  "natural almond butter": { section: "Pantry & Dry Goods" },
  "cashew butter": { section: "Pantry & Dry Goods" },
  "peanut butter": { section: "Pantry & Dry Goods" },
  "natural peanut butter": { section: "Pantry & Dry Goods" },
  "nut butter": { section: "Pantry & Dry Goods" },

  // ── Wrong section: items mislabeled as Bakery ───────────────────────────────
  "everything bagel seasoning": { section: "Condiments & Spices" },
  // "broken" describes prep — you buy whole tortilla chips and break them.
  "broken tortilla chips": { buyItem: "tortilla chips", section: "Pantry & Dry Goods" },

  // ── Frozen aisle (no Frozen section existed; frozen items sat in Produce/Pantry)
  "banana, frozen": { section: "Frozen" },
  "strawberries, frozen": { section: "Frozen" },
  "frozen baby lima beans": { section: "Frozen" },
  "frozen broccoli, thawed": { section: "Frozen" },
  "frozen cut okra": { section: "Frozen" },
  "frozen sliced okra": { section: "Frozen" },
  "frozen mixed vegetables": { section: "Frozen" },

  // ── Chopped/sliced countable veg -> approximate whole count (shopping only) ──
  // Medium veg: ~1 cup chopped ≈ 1 whole. Keeps display wording, collapses the list.
  "chopped green bell pepper": { buyItem: "green bell pepper", convert: cupTo("each") },
  "chopped red bell pepper": { buyItem: "red bell pepper", convert: cupTo("each") },
  "chopped yellow bell pepper": { buyItem: "yellow bell pepper", convert: cupTo("each") },
  "chopped red onion": { buyItem: "red onion", convert: cupTo("each") },
  "diced red onion": { buyItem: "red onion", convert: cupTo("each") },
  "thinly sliced red onion": { buyItem: "red onion", convert: cupTo("each") },
  "chopped yellow onion": { buyItem: "yellow onion", convert: cupTo("each") },
  "thinly sliced yellow onion": { buyItem: "yellow onion", convert: cupTo("each") },
  "chopped sweet onion": { buyItem: "sweet onion", convert: cupTo("each") },
  "diced cucumber": { buyItem: "cucumber", convert: cupTo("each") },
  "sliced cucumber": { buyItem: "cucumber", convert: cupTo("each") },
  "chopped english cucumber": { buyItem: "english cucumber", convert: cupTo("each") },
  "sliced english cucumber": { buyItem: "english cucumber", convert: cupTo("each") },
  "diced potatoes": { buyItem: "potatoes", convert: cupTo("each") },
  // Carrots: ~1 cup shredded/sliced ≈ 1 carrot.
  "shredded carrots": { buyItem: "carrots", convert: cupTo("each") },
  "thinly sliced carrots": { buyItem: "carrots", convert: cupTo("each") },
  "matchstick carrots": { buyItem: "carrots", convert: cupTo("each") },
  // Shallots are small: ~1 cup chopped ≈ 3 shallots.
  "finely chopped shallot": { buyItem: "shallots", convert: cupTo("each", 3) },

  // ── Prep-modified leafy/herbs/pantry -> merge the NAME only (no count) ───────
  // Sold by bunch/bag/jar, not "each" — collapse the line, keep the volume.
  "chopped arugula": { buyItem: "arugula" },
  "chopped baby kale": { buyItem: "baby kale" },
  "chopped kale": { buyItem: "kale" },
  "chopped raw kale": { buyItem: "kale" },
  "chopped cabbage": { buyItem: "cabbage" },
  "chopped romaine lettuce": { buyItem: "romaine lettuce" },
  "chopped parsley": { buyItem: "fresh parsley", section: "Produce" },
  "freshly chopped parsley": { buyItem: "fresh parsley", section: "Produce" },
  "chopped fresh parsley": { buyItem: "fresh parsley", section: "Produce" },
  "chopped fresh cilantro": { buyItem: "fresh cilantro", section: "Produce" },
  "chopped fresh dill": { buyItem: "fresh dill", section: "Produce" },
  "chopped fresh mint": { buyItem: "fresh mint", section: "Produce" },
  "chopped fresh chives": { buyItem: "fresh chives", section: "Produce" },
  "chopped fresh oregano": { buyItem: "fresh oregano", section: "Produce" },
  "sliced fresh basil": { buyItem: "fresh basil", section: "Produce" },
  "chopped green onion": { buyItem: "green onions", section: "Produce" },
  "sliced scallions": { buyItem: "green onions", section: "Produce" },
  "chopped walnuts": { buyItem: "walnuts" },
  "chopped kalamata olives": { buyItem: "kalamata olives" },
  "sliced black olives": { buyItem: "black olives" },
  "halved cherry tomatoes": { buyItem: "cherry tomatoes" },
  "chopped sun-dried tomatoes": { buyItem: "sun-dried tomatoes", section: "Pantry & Dry Goods" },

  // ════════ Widened audit: the large Produce / Pantry / Condiments buckets ════
  // (the small Meat/Dairy/Bakery buckets were swept above). Section-only fixes
  // unless a name is also wrong.

  // ── Filed as Produce but isn't produce ──────────────────────────────────────
  "active dry yeast": { section: "Pantry & Dry Goods" },
  yeast: { section: "Pantry & Dry Goods" },
  buckwheat: { section: "Pantry & Dry Goods" },
  cacao: { section: "Pantry & Dry Goods" },
  "ground flax": { section: "Pantry & Dry Goods" },
  "mixed grain": { section: "Pantry & Dry Goods" },
  "dried white corn": { section: "Pantry & Dry Goods" },
  "yellow masarepa": { section: "Pantry & Dry Goods" },
  "dried strawberries": { section: "Pantry & Dry Goods" },
  "dried hibiscus flowers": { section: "Pantry & Dry Goods" },
  "granulated sweetener": { section: "Pantry & Dry Goods" },
  "scoop chocolate protein powder": { section: "Pantry & Dry Goods" },
  "scoop plain collagen peptides": { section: "Pantry & Dry Goods" },
  espresso: { section: "Pantry & Dry Goods" },
  "decaf espresso": { section: "Pantry & Dry Goods" },
  "instant coffee powder": { section: "Pantry & Dry Goods" },
  "white chocolate sauce": { section: "Pantry & Dry Goods" },
  "cube vegetable bouillon": { section: CANNED },
  spaghetti: { section: "Pantry & Dry Goods" },
  "lasagne sheets": { section: "Pantry & Dry Goods" },
  // canned tomato products / pasta sauces mislabeled as Produce
  passata: { section: CANNED },
  "tomato puree": { section: CANNED },
  "tomato sauce": { section: CANNED },
  "stewed tomatoes": { section: CANNED },
  "diced tomatoes": { section: CANNED },
  "lower-sodium marinara sauce": { section: CANNED },
  // meat mislabeled as Produce
  "black pudding": { section: "Meat & Poultry" },
  "chuck roast": { section: "Meat & Poultry" },
  "doner meat": { section: "Meat & Poultry" },
  "polish kabanos": { section: "Meat & Poultry" },
  // bread/pastry mislabeled as Produce
  ciabatta: { section: "Bakery" },
  "english muffins": { section: "Bakery" },
  casabe: { section: "Bakery" },
  toast: { section: "Bakery" },
  "filo pastry": { section: "Bakery" },
  "puff pastry": { section: "Bakery" },
  "shortcrust pastry": { section: "Bakery" },
  // dairy mislabeled as Produce
  "gruyère": { section: "Dairy & Eggs" },
  "reduced-calorie margarine": { section: "Dairy & Eggs" },
  "oat nog": { section: "Dairy & Eggs" },
  // typo
  challots: { item: "shallots", section: "Produce" },
  // spices/seasonings mislabeled as Produce
  "apple cider vinegar": { section: "Condiments & Spices" },
  "apple cider vinegar to taste": { section: "Condiments & Spices" },
  "celery salt": { section: "Condiments & Spices" },
  "garlic salt": { section: "Condiments & Spices" },
  "garlic granules": { section: "Condiments & Spices" },
  "granulated garlic": { section: "Condiments & Spices" },
  "garlic-and-herb seasoning": { section: "Condiments & Spices" },
  "onion salt": { section: "Condiments & Spices" },
  "red pepper flakes": { section: "Condiments & Spices" },
  sumac: { section: "Condiments & Spices" },
  "pul biber": { section: "Condiments & Spices" },
  sazon: { section: "Condiments & Spices" },
  "pumpkin spice to taste": { section: "Condiments & Spices" },
  "whole black peppercorns": { section: "Condiments & Spices" },
  // jarred sauces/pastes mislabeled as Produce
  "garlic sauce": { section: "Condiments & Spices" },
  gochujang: { section: "Condiments & Spices" },
  "louisiana hot sauce": { section: "Condiments & Spices" },
  "sweet chili sauce": { section: "Condiments & Spices" },
  "tomato ketchup": { section: "Condiments & Spices" },
  "red pepper paste": { section: "Condiments & Spices" },
  "thai green curry paste": { section: "Condiments & Spices" },
  "thai red curry paste": { section: "Condiments & Spices" },
  "pickled jalapeno slices": { section: "Condiments & Spices" },
  // cooking wines mislabeled as Produce
  "dry sherry": { section: "Condiments & Spices" },
  sherry: { section: "Condiments & Spices" },
  "sweet sherry": { section: "Condiments & Spices" },
  sake: { section: "Condiments & Spices" },
  mirin: { section: "Condiments & Spices" },

  // ── Filed as Pantry but belongs elsewhere ───────────────────────────────────
  "bean sprouts": { section: "Produce" },
  "fresh green beans": { section: "Produce" },
  "runner beans": { section: "Produce" },
  "chinese long beans": { section: "Produce" },
  "pumpkin, deseeded and chunked": { section: "Produce" },
  "extra-firm tofu": { section: "Produce" },
  // ground/whole spices filed under Pantry -> Spices
  nutmeg: { section: "Condiments & Spices" },
  "ground nutmeg": { section: "Condiments & Spices" },
  "grated nutmeg": { section: "Condiments & Spices" },
  "caraway seed": { section: "Condiments & Spices" },
  "cumin seeds": { section: "Condiments & Spices" },
  "fennel seeds": { section: "Condiments & Spices" },
  "mustard seeds": { section: "Condiments & Spices" },
  "pimento seeds": { section: "Condiments & Spices" },

  // ── Filed as Condiments & Spices but isn't ──────────────────────────────────
  "baking soda": { section: "Pantry & Dry Goods" },
  "cocoa powder": { section: "Pantry & Dry Goods" },
  "scoops vanilla protein powder": { section: "Pantry & Dry Goods" },
  // broth & stock (soups) -> Canned Goods
  "low sodium vegetable broth": { section: CANNED },
  "low-sodium vegetable broth": { section: CANNED },
  "unsalted vegetable broth": { section: CANNED },
  "vegetable stock": { section: CANNED },
  "vegetable stock cube": { section: CANNED },
  "beef stock": { section: CANNED },
  "chicken broth": { section: CANNED },
  "chicken stock": { section: CANNED },
  "chicken stock cube": { section: CANNED },
  "low-sodium chicken broth": { section: CANNED },
  "low-sodium chicken stock": { section: CANNED },
  "lower-sodium chicken broth": { section: CANNED },
  "reduced-sodium chicken broth": { section: CANNED },
  "unsalted chicken broth": { section: CANNED },
  // fresh herbs mislabeled as Condiments & Spices (dried herbs stay)
  basil: { section: "Produce" },
  "basil leaves": { section: "Produce" },
  "fresh basil leaves": { section: "Produce" },
  "fresh cilantro": { section: "Produce" },
  parsley: { section: "Produce" },
  "fresh thyme": { section: "Produce" },
  thyme: { section: "Produce" },
  mint: { section: "Produce" },
  oregano: { section: "Produce" },
  "chopped fresh herbs": { section: "Produce" },
  "chopped mixed fresh herbs": { section: "Produce" },
  ginger: { section: "Produce" },
  "grated fresh ginger": { section: "Produce", buyItem: "fresh ginger" },
  // fresh peppers mislabeled as Condiments & Spices
  "green pepper": { section: "Produce" },
  "yellow pepper": { section: "Produce" },
  "romano pepper": { section: "Produce" },
  "serrano peppers": { section: "Produce" },
  "scotch bonnet pepper": { section: "Produce" },

  // ── Canned Goods (the rest live near the tomato/broth blocks above) ─────────
  // Beans sold canned by convention or carrying a `can`/`oz` unit in the data.
  // Dried staples (dried lentils/split peas/dal, bare "lentils") stay in Pantry.
  "canned diced tomatoes": { section: CANNED },
  "marinara sauce": { section: CANNED },
  "whole beets": { section: CANNED },
  "coconut milk": { section: CANNED },
  "light coconut milk": { section: CANNED },
  "canned black beans": { section: CANNED },
  "canned chickpeas": { section: CANNED },
  "canned french green lentils": { section: CANNED },
  "canned kidney beans": { section: CANNED },
  "cannellini beans": { section: CANNED },
  chickpeas: { section: CANNED },
  "garbanzo beans": { section: CANNED },
  "kidney beans": { section: CANNED },
  "navy beans": { section: CANNED },
  "white beans": { section: CANNED },
  "low-sodium black beans": { section: CANNED },
  "no-salt-added black beans": { section: CANNED },
  "no-salt-added cannellini beans": { section: CANNED },
  "no-salt-added chickpeas": { section: CANNED },
  "no-salt-added white beans": { section: CANNED },

  // ── Plural/synonym merges (shopping-only, via buyItem) ──────────────────────
  // Collapse duplicate lines like "onion" + "onions". Display + the raw-fed planner
  // are untouched. Only fold genuinely identical items — never a narrower into a
  // broader category (no "green beans" -> "beans").
  onions: { buyItem: "onion" },
  "red onions": { buyItem: "red onion" },
  shallot: { buyItem: "shallots" },
  scallion: { buyItem: "green onions", section: "Produce" },
  scallions: { buyItem: "green onions", section: "Produce" },
  "green onion": { buyItem: "green onions", section: "Produce" },
  "fresh scallions": { buyItem: "green onions", section: "Produce" },
  carrot: { buyItem: "carrots" },
  potato: { buyItem: "potatoes" },
  tomatoes: { buyItem: "tomato" },
  lemons: { buyItem: "lemon" },
  apples: { buyItem: "apple" },
  eggs: { buyItem: "egg" },
  zucchinis: { buyItem: "zucchini" },
  "english cucumbers": { buyItem: "english cucumber" },

  // Ambiguous-bean call: bare "green beans" is fresh far more often than canned here.
  "green beans": { section: "Produce" },

  // ── Non-grocery items: drop from the shopping list ──────────────────────────
  water: { exclude: true },
  "cold water": { exclude: true },
  "warm water": { exclude: true },
  "water to cover": { exclude: true },
  "gallon water": { exclude: true },
  "quarts water": { exclude: true },
  ice: { exclude: true },
  "ice cubes": { exclude: true },
  "ice to fill the glass": { exclude: true },
};

function applyConvert(ing: Ingredient, conv: ItemOverride["convert"]): Ingredient {
  if (!conv || ing.unit !== conv.from || ing.qty == null) return ing;
  return { ...ing, qty: ing.qty * conv.factor, unit: conv.to };
}

/** Display pass: fix mislabeled names and wrong sections; keep prep wording.
 *  Records `normalizedFrom` whenever the visible name or section changed. */
export function normalizeIngredientForDisplay(ing: Ingredient): Ingredient {
  const o = OVERRIDES[ing.item];
  if (!o) return ing;
  const item = o.item ?? ing.item;
  const section = o.section ?? ing.section;
  if (item === ing.item && section === ing.section) return ing;
  const from: { item?: string; section?: Section } = {};
  if (item !== ing.item) from.item = ing.item;
  if (section !== ing.section) from.section = ing.section;
  return { ...ing, item, section, normalizedFrom: from };
}

/** Shopping pass: display fixes + collapse prep-modified veg into whole counts, and
 *  re-derive a consistent `staple` flag (the source data's is unreliable — see staples.ts). */
export function normalizeIngredientForShopping(ing: Ingredient): Ingredient {
  const o = OVERRIDES[ing.item];
  if (o?.exclude) return { ...ing, exclude_from_shopping: true };
  const converted = o ? applyConvert(ing, o.convert) : ing;
  const item = o?.buyItem ?? o?.item ?? converted.item;
  const section = o?.section ?? converted.section;
  return { ...converted, item, section, staple: isStaple(ing.buy_as ?? item, section) };
}

export function normalizeForDisplay(recipes: Recipe[]): Recipe[] {
  return recipes.map((r) => ({
    ...r,
    ingredients: r.ingredients.map(normalizeIngredientForDisplay),
  }));
}

export function normalizeForShopping(meals: Recipe[]): Recipe[] {
  return meals.map((r) => ({
    ...r,
    ingredients: r.ingredients.map(normalizeIngredientForShopping),
  }));
}
