import { describe, it, expect } from "vitest";
import {
  planData,
  savedPlanToRow,
  activePlanFromRow,
  savedPlanFromRow,
  favoritesFromRows,
  checkedFromRows,
  cookEventFromRow,
  cookEventToRow,
  itemLocationFromRow,
  itemLocationToRow,
  stateFromRows,
  householdIsEmpty,
  type PlanRow,
  type CookLogRow,
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
    expect(data).toEqual({ days: samplePlan, locked: ["0:dinner"], stapleNeeds: [], amountOverrides: {}, merges: {} });
    const row = { data } as PlanRow;
    expect(activePlanFromRow(row)).toEqual({ activePlan: samplePlan, locked: ["0:dinner"], stapleNeeds: [], amountOverrides: {}, merges: {} });
  });

  it("tolerates a missing/empty data blob", () => {
    expect(activePlanFromRow({ data: undefined } as unknown as PlanRow)).toEqual({ activePlan: [], locked: [], stapleNeeds: [], amountOverrides: {}, merges: {} });
  });

  it("maps a saved plan to a row and back (saved plans drop locks)", () => {
    const sp: SavedPlan = { id: "11111111-1111-1111-1111-111111111111", name: "Holiday", createdAt: 0, plan: samplePlan };
    const row = savedPlanToRow(sp, "hh-1");
    expect(row).toMatchObject({ id: sp.id, household_id: "hh-1", name: "Holiday", is_active: false });
    expect(row.data).toEqual({ days: samplePlan, locked: [], stapleNeeds: [] });

    const back = savedPlanFromRow({ ...(row as PlanRow), created_at: "1970-01-01T00:00:00.000Z" });
    expect(back).toEqual({ id: sp.id, name: "Holiday", createdAt: 0, plan: samplePlan });
  });

  it("maps favorites and check-offs from rows", () => {
    expect(favoritesFromRows([{ household_id: "h", recipe_id: "b" }, { household_id: "h", recipe_id: "a" }])).toEqual(["a", "b"]);
    expect(checkedFromRows([{ plan_id: "p", item_name: "Produce:onion" }])).toEqual(["Produce:onion"]);
  });

  it("maps a cook_log row to a CookEvent and an event back to an insert row", () => {
    const row: CookLogRow = {
      id: "c1", household_id: "h", recipe_id: "r", cooked_on: "2026-06-02",
      cooked_by: "u", rating: 4, make_again: true, notes: "tasty", plan_id: "p1",
    };
    expect(cookEventFromRow(row)).toEqual({
      id: "c1", recipeId: "r", cookedOn: "2026-06-02", rating: 4, makeAgain: true, notes: "tasty", planId: "p1", source: null,
    });
    expect(cookEventToRow({ id: "c1", recipeId: "r", cookedOn: "2026-06-02", rating: 4, makeAgain: true, notes: "tasty", planId: "p1" }, "h", "u"))
      .toEqual({ id: "c1", household_id: "h", recipe_id: "r", cooked_on: "2026-06-02", cooked_by: "u", rating: 4, make_again: true, notes: "tasty", plan_id: "p1", source: null });
  });

  it("maps an item_location row to ItemLocation and back (fetched_at round-trips)", () => {
    const iso = "2026-06-21T00:00:00.000Z";
    const row = { household_id: "h", item_name: "onion", aisle: "Aisle 35", aisle_number: 35, department: "Produce", price: 1.29, product: "Yellow Onion", fetched_at: iso };
    const loc = itemLocationFromRow(row);
    expect(loc).toEqual({ name: "onion", aisle: "Aisle 35", aisleNumber: 35, bay: null, shelf: null, side: null, department: "Produce", price: 1.29, product: "Yellow Onion", fetchedAt: Date.parse(iso) });
    expect(itemLocationToRow(loc, "h")).toMatchObject({ household_id: "h", item_name: "onion", aisle_number: 35, department: "Produce", fetched_at: iso });
  });

  it("assembles a full AppState from row sets", () => {
    const state = stateFromRows({
      activePlanRow: { id: "p1", data: { days: samplePlan, locked: ["0:dinner"] } } as PlanRow,
      savedPlanRows: [{ id: "s1", household_id: "h", name: "Saved", is_active: false, created_at: "1970-01-01T00:00:00.000Z", data: { days: emptyPlan(), locked: [] } } as PlanRow],
      favoriteRows: [{ household_id: "h", recipe_id: "x" }],
      checkoffRows: [{ plan_id: "p1", item_name: "Produce:onion" }],
      cookLogRows: [{ id: "c1", household_id: "h", recipe_id: "r", cooked_on: "2026-06-02", rating: null, make_again: null, notes: null, plan_id: "p1" }],
      itemLocationRows: [{ household_id: "h", item_name: "onion", aisle: "Aisle 35", aisle_number: 35, department: "Produce", fetched_at: "2026-06-21T00:00:00.000Z" }],
      userRecipeRows: [{ id: "u-1", household_id: "h", data: { id: "ignored", title: "Imported", servings: 2 } as never, source_url: "https://x.test" }],
      emptyPlan,
    });
    expect(state.activePlan).toEqual(samplePlan);
    expect(state.locked).toEqual(["0:dinner"]);
    expect(state.savedPlans).toHaveLength(1);
    expect(state.favorites).toEqual(["x"]);
    expect(state.checked).toEqual(["Produce:onion"]);
    expect(state.cookLog).toEqual([{ id: "c1", recipeId: "r", cookedOn: "2026-06-02", rating: null, makeAgain: null, notes: null, planId: "p1", source: null }]);
    expect(state.itemLocations).toEqual([{ name: "onion", aisle: "Aisle 35", aisleNumber: 35, bay: null, shelf: null, side: null, department: "Produce", price: null, product: null, fetchedAt: Date.parse("2026-06-21T00:00:00.000Z") }]);
    // user recipe: id comes from the row, not the embedded data
    expect(state.userRecipes).toEqual([{ id: "u-1", title: "Imported", servings: 2 }]);
  });

  it("uses an empty plan when there is no active plan row", () => {
    const state = stateFromRows({ activePlanRow: null, savedPlanRows: [], favoriteRows: [], checkoffRows: [], cookLogRows: [], itemLocationRows: [], userRecipeRows: [], emptyPlan });
    expect(state.activePlan).toEqual(emptyPlan());
    expect(state.cookLog).toEqual([]);
    expect(state.itemLocations).toEqual([]);
    expect(state.userRecipes).toEqual([]);
  });

  it("detects an empty household for the one-time import", () => {
    expect(householdIsEmpty({ activePlanRow: null, savedPlanRows: [], favoriteRows: [] })).toBe(true);
    expect(householdIsEmpty({ activePlanRow: { id: "p" } as PlanRow, savedPlanRows: [], favoriteRows: [] })).toBe(false);
    expect(householdIsEmpty({ activePlanRow: null, savedPlanRows: [], favoriteRows: [], cookLogRows: [{ id: "c" } as CookLogRow] })).toBe(false);
  });
});
