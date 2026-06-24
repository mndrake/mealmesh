import { describe, it, expect } from "vitest";
import { coachImageUrl, coachRecipeToRecipe, coachRecipesById, menuToPlan } from "./planBridge";
import imageSourcesData from "../../data/coach/image-sources.json";
import { getMenu, listMenus } from "./content";
import { mergeRecipesById } from "../allRecipes";
import { cookedMeals } from "../planner";
import { buildList } from "../shopping";
import { scaledShoppingMeals } from "../scaling";
import menuRecipeData from "../../data/coach/menu-recipes.json";
import menuIngredientsData from "../../data/coach/menu-ingredients.json";
import type { CoachRecipe } from "./types";

const COACH_RECIPES = menuRecipeData.recipes as CoachRecipe[];

describe("coachRecipeToRecipe", () => {
  it("adapts a coach recipe to a full Recipe with ingredients", () => {
    const cr = COACH_RECIPES.find((r) => r.id === "m1a-mon-sheetpan-chicken-broccoli")!;
    const r = coachRecipeToRecipe(cr);
    expect(r.id).toBe(cr.id);
    expect(r.category).toBe("dinner");
    expect(r.ingredients.length).toBeGreaterThan(0);
    expect(r.method).toMatch(/Preheat/); // steps joined into method
    expect(r.tags).toContain("coach");
    expect(r.method_is_link_only).toBe(false);
  });

  it("displays net carbs exactly and does not invent other macros", () => {
    for (const cr of COACH_RECIPES) {
      const r = coachRecipeToRecipe(cr);
      const net = r.nutrition_per_serving.carb_g - r.nutrition_per_serving.fiber_g;
      expect(net, cr.id).toBe(cr.net_carbs_g);
      expect(r.nutrition_estimated).toBe(true);
    }
  });
});

describe("menuToPlan", () => {
  const plan = menuToPlan(getMenu("month1-a")!);

  it("is a 7-day plan with weekends open", () => {
    expect(plan.length).toBe(7);
    const sat = plan.find((d) => d.day === "Sat")!;
    expect(sat.breakfast).toBeNull();
    expect(sat.dinner).toBeNull();
  });

  it("batch breakfast/lunch are leftover after Monday (so shopping counts them once)", () => {
    const mon = plan.find((d) => d.day === "Mon")!;
    const tue = plan.find((d) => d.day === "Tue")!;
    expect(mon.breakfast).toEqual({ id: "m1a-bfast-egg-bites", leftover: false });
    expect(tue.breakfast).toEqual({ id: "m1a-bfast-egg-bites", leftover: true });
    expect(tue.lunch).toEqual({ id: "m1a-lunch-cobb-jar", leftover: true });
  });

  it("places each dinner on its day", () => {
    const wed = plan.find((d) => d.day === "Wed")!;
    expect(wed.dinner).toEqual({ id: "m1a-wed-shrimp-scampi-zoodles", leftover: false });
  });
});

describe("recipe resolution (Plan board won't show '(unknown)')", () => {
  it("coach recipes resolve in the merged by-id map", () => {
    const byId = mergeRecipesById([]); // no user recipes
    for (const m of listMenus()) {
      const ids = [m.breakfast_id, m.lunch_id, ...m.dinners.map((d) => d.recipe_id)];
      for (const id of ids) {
        expect(byId.get(id)?.title, id).toBeTruthy();
      }
    }
  });
});

// ---- The user's explicit ask: a Coach week produces a working shopping list ----
describe("shopping list from a Coach week", () => {
  const byId = coachRecipesById();
  const plan = menuToPlan(getMenu("month1-a")!);

  it("default weekly path: batch meals counted once, real items + staples", () => {
    const meals = cookedMeals(plan, byId); // skips leftovers
    expect(meals.length).toBe(7); // breakfast + lunch (once each) + 5 dinners
    const list = buildList(meals);
    const items = list.sections.flatMap((s) => s.items.map(([name]) => name.toLowerCase()));
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((n) => n.includes("broccoli"))).toBe(true);
    expect(items.some((n) => n.includes("shrimp"))).toBe(true);
    // pantry staples are separated out of the buy list
    expect(list.staples.some((s) => /salt/i.test(s))).toBe(true);
    // egg bites appear once (batch), not 5×: eggs listed once with a single qty
    const eggRows = list.sections.flatMap((s) => s.items).filter(([n]) => /^eggs?$/i.test(n));
    expect(eggRows.length).toBeLessThanOrEqual(1);
  });

  it("scaled path: batch breakfast scales by coverage, not duplicated", () => {
    const meals = scaledShoppingMeals(plan, byId, 2); // household of 2
    const ids = meals.map((m) => m.id);
    // each distinct recipe appears once even though breakfast/lunch span 5 days
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("m1a-bfast-egg-bites");
  });
});

// ---- Every menu recipe has a sourced, attributed photo ----
describe("coach recipe images", () => {
  const IMAGES = (imageSourcesData as { images: Record<string, { license: string }> }).images;
  it("every menu recipe has an attributed image + the adapter wires imageUrl/attribution", () => {
    for (const cr of COACH_RECIPES) {
      // attribution present (the fetch script only records an entry on a successful download)
      expect(IMAGES[cr.id]?.license, cr.id).toBeTruthy();
      const url = coachImageUrl(cr.id);
      expect(url, cr.id).toBe(`/coach-images/${cr.id}.jpg`);
      const r = coachRecipeToRecipe(cr);
      expect(r.imageUrl).toBe(url);
      expect(r.image_source?.repository).toBe("Wikimedia Commons");
      expect(r.image_source?.note, cr.id).toBeTruthy(); // artist · license
    }
  });
  it("only uses freely-licensed images (CC0 / CC BY / CC BY-SA / Public domain)", () => {
    for (const [id, m] of Object.entries(IMAGES)) {
      expect(m.license, id).toMatch(/cc0|cc by|public domain|^pd/i);
    }
  });
});

// ---- Integrity: every menu recipe has authored ingredients ----
describe("menu ingredient coverage", () => {
  const EXTRA = menuIngredientsData as unknown as Record<string, { ingredients: unknown[] }>;
  it("every menu slot recipe has non-empty ingredients", () => {
    for (const m of listMenus()) {
      const ids = [m.breakfast_id, m.lunch_id, ...m.dinners.map((d) => d.recipe_id)];
      for (const id of ids) {
        expect(EXTRA[id]?.ingredients?.length, id).toBeGreaterThan(0);
      }
    }
  });
});
