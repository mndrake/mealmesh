import { describe, it, expect } from "vitest";
import {
  planData,
  savedPlanToRow,
  activePlanFromRow,
  savedPlanFromRow,
  favoritesFromRows,
  checkedFromRows,
  stateFromRows,
  householdIsEmpty,
  type PlanRow,
} from "../cloudMap";
import type { Plan } from "../types";
import type { SavedPlan } from "../store";

const day = (d: string): Plan[number] => ({ day: d, breakfast: null, lunch: null, dinner: null, snack: null });
const emptyPlan = (): Plan => ["Mon", "Tue"].map(day);

const samplePlan: Plan = [
  { ...day("Mon"), dinner: { id: "beef-and-broccoli-stir-fry", leftover: false } },
  day("Tue"),
];

describe("cloudMap", () => {
  it("wraps active plan + locked into the data JSONB and back", () => {
    const data = planData(samplePlan, ["0:dinner"]);
    expect(data).toEqual({ days: samplePlan, locked: ["0:dinner"] });
    const row = { data } as PlanRow;
    expect(activePlanFromRow(row)).toEqual({ activePlan: samplePlan, locked: ["0:dinner"] });
  });

  it("tolerates a missing/empty data blob", () => {
    expect(activePlanFromRow({ data: undefined } as unknown as PlanRow)).toEqual({ activePlan: [], locked: [] });
  });

  it("maps a saved plan to a row and back (saved plans drop locks)", () => {
    const sp: SavedPlan = { id: "11111111-1111-1111-1111-111111111111", name: "Holiday", createdAt: 0, plan: samplePlan };
    const row = savedPlanToRow(sp, "hh-1");
    expect(row).toMatchObject({ id: sp.id, household_id: "hh-1", name: "Holiday", is_active: false });
    expect(row.data).toEqual({ days: samplePlan, locked: [] });

    const back = savedPlanFromRow({ ...(row as PlanRow), created_at: "1970-01-01T00:00:00.000Z" });
    expect(back).toEqual({ id: sp.id, name: "Holiday", createdAt: 0, plan: samplePlan });
  });

  it("maps favorites and check-offs from rows", () => {
    expect(favoritesFromRows([{ household_id: "h", recipe_id: "b" }, { household_id: "h", recipe_id: "a" }])).toEqual(["a", "b"]);
    expect(checkedFromRows([{ plan_id: "p", item_name: "Produce:onion" }])).toEqual(["Produce:onion"]);
  });

  it("assembles a full AppState from row sets", () => {
    const state = stateFromRows({
      activePlanRow: { id: "p1", data: { days: samplePlan, locked: ["0:dinner"] } } as PlanRow,
      savedPlanRows: [{ id: "s1", household_id: "h", name: "Saved", is_active: false, created_at: "1970-01-01T00:00:00.000Z", data: { days: emptyPlan(), locked: [] } } as PlanRow],
      favoriteRows: [{ household_id: "h", recipe_id: "x" }],
      checkoffRows: [{ plan_id: "p1", item_name: "Produce:onion" }],
      emptyPlan,
    });
    expect(state.activePlan).toEqual(samplePlan);
    expect(state.locked).toEqual(["0:dinner"]);
    expect(state.savedPlans).toHaveLength(1);
    expect(state.favorites).toEqual(["x"]);
    expect(state.checked).toEqual(["Produce:onion"]);
  });

  it("uses an empty plan when there is no active plan row", () => {
    const state = stateFromRows({ activePlanRow: null, savedPlanRows: [], favoriteRows: [], checkoffRows: [], emptyPlan });
    expect(state.activePlan).toEqual(emptyPlan());
  });

  it("detects an empty household for the one-time import", () => {
    expect(householdIsEmpty({ activePlanRow: null, savedPlanRows: [], favoriteRows: [] })).toBe(true);
    expect(householdIsEmpty({ activePlanRow: { id: "p" } as PlanRow, savedPlanRows: [], favoriteRows: [] })).toBe(false);
  });
});
