import { describe, it, expect } from "vitest";
import {
  checkDoneness,
  coachRecipeTitle,
  getBlueprint,
  getCoachRecipe,
  getDonenessRule,
  getMenu,
  getRecipeSteps,
  getTechnique,
  hasCoachContent,
  listBlueprints,
  listMenus,
} from "./content";
import donenessData from "../../data/coach/doneness.json";
import recipeStepData from "../../data/coach/recipe-steps.json";
import menuRecipeData from "../../data/coach/menu-recipes.json";
import type { CoachRecipe, DonenessRule, RecipeSteps } from "./types";

const RULES = donenessData.rules as DonenessRule[];
const COACH_RECIPES = menuRecipeData.recipes as CoachRecipe[];

describe("getDonenessRule", () => {
  it("matches by canonical key", () => {
    expect(getDonenessRule("chicken")?.food).toBe("chicken");
  });
  it("matches by alias and is case/space tolerant", () => {
    expect(getDonenessRule("Chicken Breast")?.food).toBe("chicken");
    expect(getDonenessRule("salmon")?.food).toBe("fish");
  });
  it("matches when the rule alias is contained in a longer phrase", () => {
    expect(getDonenessRule("two chicken breasts, cubed")?.food).toBe("chicken");
  });
  it("returns null for unknown foods", () => {
    expect(getDonenessRule("dragonfruit")).toBeNull();
    expect(getDonenessRule(undefined)).toBeNull();
  });
});

describe("checkDoneness", () => {
  it("calls a reading at/above the safe minimum done", () => {
    const v = checkDoneness("chicken", { measuredTempF: 170 });
    expect(v.found).toBe(true);
    expect(v.meetsTemp).toBe(true);
    expect(v.guidance).toMatch(/done/i);
  });

  it("calls a reading below the safe minimum NOT done and says don't eat it", () => {
    const v = checkDoneness("chicken", { measuredTempF: 150 });
    expect(v.meetsTemp).toBe(false);
    expect(v.guidance).toMatch(/keep cooking/i);
    expect(v.guidance).toMatch(/do not eat/i);
  });

  it("at exactly the safe minimum is done", () => {
    expect(checkDoneness("chicken", { measuredTempF: 165 }).meetsTemp).toBe(true);
  });

  it("includes the rest time for whole cuts", () => {
    const v = checkDoneness("steak", { measuredTempF: 145 });
    expect(v.meetsTemp).toBe(true);
    expect(v.guidance).toMatch(/rest 3 minute/i);
  });

  it("gives the target temp when no reading is supplied", () => {
    const v = checkDoneness("chicken");
    expect(v.meetsTemp).toBeNull();
    expect(v.guidance).toMatch(/165°F/);
  });

  it("uses a visual rule (no temp) for shrimp even if a reading is passed", () => {
    const v = checkDoneness("shrimp", { measuredTempF: 200 });
    expect(v.found).toBe(true);
    expect(v.rule?.pull_temp_f).toBeNull();
    expect(v.meetsTemp).toBeNull();
    expect(v.guidance).toMatch(/pearly|opaque/i);
  });

  it("returns a safe fallback for unknown foods (no fabricated verdict)", () => {
    const v = checkDoneness("mystery meat", { measuredTempF: 100 });
    expect(v.found).toBe(false);
    expect(v.meetsTemp).toBeNull();
    expect(v.guidance).toMatch(/thermometer/i);
  });
});

describe("recipe step content", () => {
  it("exposes the seed recipe end-to-end", () => {
    expect(hasCoachContent("brown-stew-chicken")).toBe(true);
    const steps = getRecipeSteps("brown-stew-chicken");
    expect(steps?.steps.length).toBe(6);
    // the final step carries the doneness check
    expect(steps?.steps.at(-1)?.doneness_food).toBe("chicken");
  });
  it("returns null for recipes without coach content", () => {
    expect(hasCoachContent("nonexistent")).toBe(false);
    expect(getRecipeSteps("nonexistent")).toBeNull();
  });
  it("has at least one batch blueprint", () => {
    expect(listBlueprints().length).toBeGreaterThan(0);
  });
});

// ---- Month-1 weekly rotation (selectable targets) ----
describe("weekly menus", () => {
  it("exposes two Month-1 menus", () => {
    const menus = listMenus();
    expect(menus.length).toBeGreaterThanOrEqual(2);
    expect(getMenu("month1-a")?.label).toMatch(/Menu A/);
    expect(getMenu("month1-b")?.label).toMatch(/Menu B/);
  });

  it("every slot in every menu resolves to a coach recipe with steps", () => {
    for (const m of listMenus()) {
      const ids = [m.breakfast_id, m.lunch_id, ...m.dinners.map((d) => d.recipe_id)];
      for (const id of ids) {
        expect(getCoachRecipe(id), `${m.id} → ${id}`).not.toBeNull();
        expect(getRecipeSteps(id)?.steps.length, `${m.id} → ${id} steps`).toBeGreaterThan(0);
        expect(coachRecipeTitle(id)).not.toBe(id); // resolved to a real title
      }
    }
  });

  it("every menu's prep blueprint exists", () => {
    for (const m of listMenus()) {
      if (m.prep_blueprint_id) {
        expect(getBlueprint(m.prep_blueprint_id), m.id).not.toBeNull();
      }
    }
  });

  it("each Month-1 menu is a full week (breakfast, lunch, 5 dinners)", () => {
    for (const id of ["month1-a", "month1-b"]) {
      const m = getMenu(id)!;
      expect(m.dinners.length).toBe(5);
    }
  });
});

// ---- Safety / drift invariants: these protect the food-safety contract (PRD §10). ----
describe("content integrity", () => {
  // Every recipe with guided steps, from both sources (overlays + self-contained menu recipes).
  const allStepSets: RecipeSteps[] = [
    ...(recipeStepData.recipes as RecipeSteps[]),
    ...COACH_RECIPES.map((r) => ({ recipe_id: r.id, steps: r.steps })),
  ];

  it("every doneness rule is cited with a source URL", () => {
    for (const r of RULES) {
      expect(r.source?.url, `${r.food} must have a source URL`).toMatch(/^https?:\/\//);
      expect(r.source?.name?.length).toBeGreaterThan(0);
    }
  });

  it("every step's doneness_food resolves to a real rule", () => {
    for (const r of allStepSets) {
      for (const s of r.steps) {
        if (s.doneness_food) {
          expect(getDonenessRule(s.doneness_food), `${r.recipe_id}/${s.id}`).not.toBeNull();
        }
      }
    }
  });

  it("every step's technique_id resolves to a real technique", () => {
    for (const r of allStepSets) {
      for (const s of r.steps) {
        if (s.technique_id) {
          expect(getTechnique(s.technique_id), `${r.recipe_id}/${s.id}`).not.toBeNull();
        }
      }
    }
  });
});
