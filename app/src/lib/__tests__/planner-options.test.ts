import { describe, it, expect } from "vitest";
import { rawRecipes, recipesById } from "../recipes";
import { buildPlan } from "../planner";
import type { MealRef } from "../types";

const WEEKDAYS = [0, 1, 2, 3, 4];
const id = (ref: unknown) => (ref as MealRef).id;

describe("planner weekday-prep options", () => {
  const onPlan = buildPlan(rawRecipes); // defaults: both restrictions on

  it("by default restricts Mon–Fri breakfasts to make-ahead / no-cook", () => {
    for (const di of WEEKDAYS) {
      const b = recipesById.get(id(onPlan[di].breakfast))!;
      expect(["no_cook", "make_ahead"]).toContain(b.prep_style);
    }
  });

  it("by default restricts Mon–Fri lunches to office-friendly no-cook", () => {
    for (const di of WEEKDAYS) {
      const l = recipesById.get(id(onPlan[di].lunch))!;
      expect(l.office_friendly).toBe(true);
      expect(l.prep_style).toBe("no_cook");
    }
  });

  it("turning the restrictions off changes the weekday selection", () => {
    const offPlan = buildPlan(rawRecipes, {
      easyWeekdayBreakfast: false,
      officeWeekdayLunch: false,
    });
    const onB = WEEKDAYS.map((di) => id(onPlan[di].breakfast)).join();
    const offB = WEEKDAYS.map((di) => id(offPlan[di].breakfast)).join();
    const onL = WEEKDAYS.map((di) => id(onPlan[di].lunch)).join();
    const offL = WEEKDAYS.map((di) => id(offPlan[di].lunch)).join();
    expect(onB !== offB || onL !== offL).toBe(true);
  });

  it("weekends are unaffected by the weekday options", () => {
    const offPlan = buildPlan(rawRecipes, {
      easyWeekdayBreakfast: false,
      officeWeekdayLunch: false,
    });
    expect(id(onPlan[5].breakfast)).toBe(id(offPlan[5].breakfast));
    expect(id(onPlan[6].breakfast)).toBe(id(offPlan[6].breakfast));
  });
});
