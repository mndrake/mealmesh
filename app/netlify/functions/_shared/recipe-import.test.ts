import { describe, it, expect } from "vitest";
import {
  isSafeImportUrl,
  htmlToText,
  parseDuration,
  parseYield,
  parseIngredientLine,
  guessSection,
  extractJsonLdRecipe,
  toDraftRecipe,
} from "./recipe-import";

describe("isSafeImportUrl", () => {
  it("allows public http(s) URLs", () => {
    expect(isSafeImportUrl("https://example.com/recipe")).toBe(true);
    expect(isSafeImportUrl("http://cooking.nytimes.com/r/1")).toBe(true);
  });
  it("rejects non-http schemes and local/private hosts (SSRF)", () => {
    expect(isSafeImportUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeImportUrl("ftp://example.com")).toBe(false);
    expect(isSafeImportUrl("http://localhost/x")).toBe(false);
    expect(isSafeImportUrl("http://127.0.0.1/x")).toBe(false);
    expect(isSafeImportUrl("http://10.0.0.5/x")).toBe(false);
    expect(isSafeImportUrl("http://192.168.1.1/x")).toBe(false);
    expect(isSafeImportUrl("http://169.254.169.254/latest/meta-data")).toBe(false); // cloud metadata
    expect(isSafeImportUrl("http://172.16.0.1/x")).toBe(false);
    expect(isSafeImportUrl("http://printer.local/x")).toBe(false);
    expect(isSafeImportUrl("not a url")).toBe(false);
  });
});

describe("parseDuration / parseYield", () => {
  it("parses ISO-8601 durations to minutes", () => {
    expect(parseDuration("PT30M")).toBe(30);
    expect(parseDuration("PT1H30M")).toBe(90);
    expect(parseDuration("PT2H")).toBe(120);
    expect(parseDuration("P1DT2H")).toBe(1560);
    expect(parseDuration("garbage")).toBeUndefined();
    expect(parseDuration(123)).toBeUndefined();
  });
  it("parses yields from numbers and strings", () => {
    expect(parseYield(4)).toBe(4);
    expect(parseYield("4 servings")).toBe(4);
    expect(parseYield(["6 servings", "6"])).toBe(6);
    expect(parseYield(undefined)).toBeUndefined();
  });
});

describe("parseIngredientLine", () => {
  it("splits qty, unit, item and a trailing note", () => {
    expect(parseIngredientLine("2 cups all-purpose flour, sifted")).toMatchObject({
      qty: 2,
      unit: "cups",
      item: "all-purpose flour",
      note: "sifted",
    });
  });
  it("handles fractions, mixed and unicode fractions", () => {
    expect(parseIngredientLine("1/2 cup milk").qty).toBe(0.5);
    expect(parseIngredientLine("1 1/2 cups sugar").qty).toBe(1.5);
    expect(parseIngredientLine("½ tsp salt").qty).toBe(0.5);
    expect(parseIngredientLine("2 ½ cups water").qty).toBe(2.5);
  });
  it("defaults unit to each when there's no unit word", () => {
    const r = parseIngredientLine("3 eggs");
    expect(r).toMatchObject({ qty: 3, unit: "each", item: "eggs" });
  });
  it("assigns a section via the keyword guesser", () => {
    expect(parseIngredientLine("2 onions").section).toBe("Produce");
  });
});

describe("guessSection", () => {
  it("maps common items to plausible sections", () => {
    expect(guessSection("yellow onion")).toBe("Produce");
    expect(guessSection("boneless chicken breast")).toBe("Meat & Poultry");
    expect(guessSection("whole milk")).toBe("Dairy & Eggs");
    expect(guessSection("flour tortillas")).toBe("Bakery");
    expect(guessSection("canned black beans")).toBe("Canned Goods (Soups, vegetables, and pasta sauces, etc.)");
    expect(guessSection("ground cumin")).toBe("Condiments & Spices");
    expect(guessSection("all-purpose flour")).toBe("Pantry & Dry Goods");
    expect(guessSection("mystery widget")).toBe("Pantry & Dry Goods"); // default
  });
});

describe("htmlToText", () => {
  it("strips tags/scripts and decodes a few entities", () => {
    const t = htmlToText("<h1>Title</h1><script>evil()</script><p>Mix flour &amp; water</p>");
    expect(t).toContain("Title");
    expect(t).toContain("Mix flour & water");
    expect(t).not.toContain("evil");
  });
});

const PAGE = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Recipe","name":"Tomato Soup",
 "recipeCuisine":"American","recipeCategory":"Dinner","recipeYield":"4 servings",
 "prepTime":"PT10M","cookTime":"PT20M",
 "recipeIngredient":["2 tbsp olive oil","1 onion, diced","4 cups crushed tomatoes","1 tsp salt"],
 "recipeInstructions":[{"@type":"HowToStep","text":"Sauté the onion."},{"@type":"HowToStep","text":"Add tomatoes and simmer."}],
 "nutrition":{"@type":"NutritionInformation","calories":"180 kcal","proteinContent":"4 g","carbohydrateContent":"20 g","fatContent":"9 g","fiberContent":"3 g"}}
</script></head><body>...</body></html>`;

describe("extractJsonLdRecipe + toDraftRecipe", () => {
  it("extracts a Recipe from JSON-LD", () => {
    const parsed = extractJsonLdRecipe(PAGE)!;
    expect(parsed.title).toBe("Tomato Soup");
    expect(parsed.cuisine).toBe("American");
    expect(parsed.category).toBe("dinner");
    expect(parsed.servings).toBe(4);
    expect(parsed.prep_minutes).toBe(10);
    expect(parsed.cook_minutes).toBe(20);
    expect(parsed.ingredients).toHaveLength(4);
    expect(parsed.ingredients[1]).toMatchObject({ qty: 1, item: "onion", note: "diced", section: "Produce" });
    expect(parsed.method).toContain("Sauté the onion.");
    expect(parsed.nutrition).toMatchObject({ kcal: 180, protein_g: 4, carb_g: 20, fat_g: 9, fiber_g: 3 });
  });

  it("returns null when there's no Recipe JSON-LD", () => {
    expect(extractJsonLdRecipe("<html><body>no recipe here</body></html>")).toBeNull();
  });

  it("finds a Recipe nested in an @graph", () => {
    const html = `<script type="application/ld+json">
      {"@graph":[{"@type":"WebPage"},{"@type":["Recipe"],"name":"X","recipeIngredient":["1 egg"]}]}</script>`;
    expect(extractJsonLdRecipe(html)?.title).toBe("X");
  });

  it("builds a complete draft Recipe with ids, sections and source", () => {
    const parsed = extractJsonLdRecipe(PAGE)!;
    let n = 0;
    const draft = toDraftRecipe(parsed, "https://www.example.com/soup", () => `u-test-${n++}`);
    expect(draft.id).toBe("u-test-0");
    expect(draft.title).toBe("Tomato Soup");
    expect(draft.category).toBe("dinner");
    expect(draft.servings).toBe(4);
    expect(draft.tags).toContain("imported");
    expect(draft.source).toMatchObject({ url: "https://www.example.com/soup", name: "example.com" });
    expect(draft.imageUrl).toBeNull();
    expect(draft.nutrition_estimated).toBe(false); // page had nutrition
    expect(draft.ingredients[0]).toMatchObject({ item: "olive oil", section: "Condiments & Spices", perishable: false });
    expect(draft.ingredients[1]).toMatchObject({ item: "onion", section: "Produce", perishable: true });
    expect(draft.method_is_link_only).toBe(false);
  });

  it("flags nutrition estimated when the page has none", () => {
    const html = `<script type="application/ld+json">{"@type":"Recipe","name":"Y","recipeIngredient":["1 cup rice"]}</script>`;
    const draft = toDraftRecipe(extractJsonLdRecipe(html)!, "https://x.test/y");
    expect(draft.nutrition_estimated).toBe(true);
    expect(draft.nutrition_per_serving.kcal).toBe(0);
    expect(draft.method_is_link_only).toBe(true); // no method text
  });
});
