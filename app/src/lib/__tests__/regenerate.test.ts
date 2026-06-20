import { describe, it, expect } from "vitest";
import { rawRecipes } from "../recipes";
import { buildPlan, regeneratePlan } from "../planner";
import type { Plan, MealRef } from "../types";

const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;

function idsIn(plan: Plan): string[] {
  const ids: string[] = [];
  for (const day of plan)
    for (const slot of SLOTS) {
      const ref = day[slot];
      if (ref && typeof ref !== "string") ids.push((ref as MealRef).id);
    }
  return ids;
}

describe("regeneratePlan", () => {
  const base = buildPlan(rawRecipes);

  it("keeps locked slots unchanged", () => {
    const locked = new Set(["2:dinner", "0:breakfast"]);
    const next = regeneratePlan(rawRecipes, base, locked, {});
    expect(next[2].dinner).toEqual(base[2].dinner);
    expect(next[0].breakfast).toEqual(base[0].breakfast);
  });

  it("does not duplicate a locked recipe elsewhere in the regenerated plan", () => {
    const lockedDinnerId = (base[2].dinner as MealRef).id;
    const locked = new Set(["2:dinner"]);
    const next = regeneratePlan(rawRecipes, base, locked, {});
    // the locked dinner stays in its slot...
    expect((next[2].dinner as MealRef).id).toBe(lockedDinnerId);
    // ...and appears exactly once across the whole plan (no pool collision)
    const count = idsIn(next).filter((id) => id === lockedDinnerId).length;
    expect(count).toBe(1);
  });

  it("with no locks behaves like a full rebuild", () => {
    const next = regeneratePlan(rawRecipes, base, new Set(), {});
    expect(idsIn(next)).toEqual(idsIn(buildPlan(rawRecipes)));
  });

  it("preserves a locked canned-snack string", () => {
    // snacks from auto-suggest are plain strings (no id)
    const snack = base[0].snack;
    expect(typeof snack).toBe("string");
    const next = regeneratePlan(rawRecipes, base, new Set(["0:snack"]), {});
    expect(next[0].snack).toBe(snack);
  });
});
