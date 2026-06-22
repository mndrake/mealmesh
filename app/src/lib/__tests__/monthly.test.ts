import { describe, it, expect } from "vitest";
import { rawRecipes, rawRecipesById } from "../recipes";
import { buildMonthlyPlan, collectPlanRecipeIds } from "../monthly";
import { cookedMeals } from "../planner";
import { planEase } from "../ease";

describe("buildMonthlyPlan", () => {
  const monthly = buildMonthlyPlan(rawRecipes);

  it("produces two labeled rotation weeks covering weeks 1-4", () => {
    expect(monthly.weeks.map((w) => w.label)).toEqual(["Weeks 1 & 3", "Weeks 2 & 4"]);
    expect(monthly.weeks.flatMap((w) => w.weeks).sort()).toEqual([1, 2, 3, 4]);
  });

  it("defaults to a 2-person household with a per-day net-carb target", () => {
    expect(monthly.householdSize).toBe(2);
    expect(monthly.netCarbTargetPerDay).toBeGreaterThan(0);
  });

  it("fills both weeks with complete 7-day plans", () => {
    for (const w of monthly.weeks) {
      expect(w.plan).toHaveLength(7);
      for (const d of w.plan) {
        expect(d.breakfast).not.toBeNull();
        expect(d.lunch).not.toBeNull();
        expect(d.dinner).not.toBeNull();
      }
    }
  });

  it("the second week differs from the first (rotation variety)", () => {
    const a = collectPlanRecipeIds(monthly.weeks[0].plan);
    const b = collectPlanRecipeIds(monthly.weeks[1].plan);
    const overlap = [...b].filter((id) => a.has(id));
    // weekB avoids weekA's recipes where pools allow — expect little to no overlap
    expect(overlap.length).toBeLessThan(a.size);
    // and the weekday breakfast/lunch should be different recipes between weeks
    expect([...a].some((id) => !b.has(id))).toBe(true);
  });

  it("each rotation week keeps a small, reused ingredient palette", () => {
    for (const w of monthly.weeks) {
      const e = planEase(cookedMeals(w.plan, rawRecipesById));
      expect(e.paletteSize).toBeLessThan(50); // ease-mode weeks stay tight
    }
  });
});
