import { describe, it, expect } from "vitest";
import { groupByAisle, locationText, isStale } from "./aisleOrder";
import type { ItemLocation } from "./types";
import type { ShoppingList } from "./shopping";

const loc = (name: string, department: string | null, aisleNumber: number | null, aisle: string | null = null): ItemLocation => ({
  name,
  department,
  aisleNumber,
  aisle,
  price: null,
  product: null,
  fetchedAt: 0,
});

const list: ShoppingList = {
  sections: [
    { section: "Produce", items: [["onion", "2"], ["spinach", "1 bag"]] },
    { section: "Dairy & Eggs", items: [["milk", "1"]] },
    { section: "Pantry & Dry Goods", items: [["rice", "1 bag"]] },
  ],
  staples: ["salt"],
};

describe("groupByAisle", () => {
  it("groups by physical aisle (aisle description, else department); unmatched go to one Other bucket", () => {
    const locations = new Map<string, ItemLocation>([
      ["onion", loc("onion", "Produce", 1, "Produce")], // aisle description "Produce"
      ["milk", loc("milk", "Dairy", 12, "Aisle 12")], // numbered aisle
      ["rice", loc("rice", "Pantry", null, null)], // no aisle → department fallback
      // spinach has no location → "Other"
    ]);
    const groups = groupByAisle(list, locations);
    const label = (n: string) => groups.find((g) => g.items.some((i) => i.name === n))?.label;
    expect(label("onion")).toBe("Produce");
    expect(label("milk")).toBe("Aisle 12");
    expect(label("rice")).toBe("Pantry"); // department fallback when no aisle
    const other = groups.find((g) => g.key === "other");
    expect(other?.label).toBe("Other (not matched at Kroger)");
    expect(other?.items.map((i) => i.name)).toEqual(["spinach"]);
    // checkoff id stays tied to the original section
    expect(other?.items[0].section).toBe("Produce");
  });

  it("groups a physically-in-produce item under its aisle even when Kroger's category differs", () => {
    // The reported bug: a fresh pepper whose aisle says Produce but category says International.
    const locations = new Map<string, ItemLocation>([
      ["onion", loc("onion", "International", 8, "Produce")], // dept International, aisle "Produce"
    ]);
    const groups = groupByAisle(list, locations);
    expect(groups.find((g) => g.items.some((i) => i.name === "onion"))?.label).toBe("Produce");
  });

  it("orders aisles by their lowest aisle number", () => {
    const locations = new Map<string, ItemLocation>([
      ["onion", loc("onion", "Produce", 30, "Aisle 30")],
      ["milk", loc("milk", "Dairy", 5, "Aisle 5")],
      ["rice", loc("rice", "Pantry", 15, "Aisle 15")],
    ]);
    const groups = groupByAisle(list, locations);
    expect(groups.filter((g) => g.key !== "other").map((g) => g.label)).toEqual(["Aisle 5", "Aisle 15", "Aisle 30"]);
    expect(groups.at(-1)?.key).toBe("other"); // spinach (no location)
  });

  it("locationText prefers aisle, then department", () => {
    expect(locationText(loc("x", "Produce", 3, "Aisle 3"))).toBe("Aisle 3");
    expect(locationText(loc("x", "Produce", null))).toBe("Produce");
    expect(locationText(null)).toBe("");
  });
});

describe("isStale", () => {
  const now = Date.UTC(2026, 5, 21);
  const withFetch = (ms: number) => ({ ...loc("x", "Produce", 3), fetchedAt: ms });

  it("flags locations older than the threshold", () => {
    expect(isStale(withFetch(now - 40 * 86_400_000), now, 30)).toBe(true);
    expect(isStale(withFetch(now - 10 * 86_400_000), now, 30)).toBe(false);
  });

  it("never flags unknown (0) fetch time or missing location", () => {
    expect(isStale(withFetch(0), now, 30)).toBe(false);
    expect(isStale(null, now, 30)).toBe(false);
  });
});
