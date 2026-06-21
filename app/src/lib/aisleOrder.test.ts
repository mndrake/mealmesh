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
  it("groups located items by Kroger department (ordered by aisle); unmatched go to one Other bucket", () => {
    const locations = new Map<string, ItemLocation>([
      ["onion", loc("onion", "Produce", 1, "Aisle 1")],
      ["milk", loc("milk", "Dairy", 12, "Aisle 12")],
      // spinach + rice have no location → single "Other" group (no fallback to our sections)
    ]);
    const groups = groupByAisle(list, locations);
    expect(groups.map((g) => g.key)).toEqual(["dept:Produce", "dept:Dairy", "other"]);
    expect(groups[0].items.map((i) => i.name)).toEqual(["onion"]);
    expect(groups[2].label).toBe("Other (not matched at Kroger)");
    expect(groups[2].items.map((i) => i.name)).toEqual(["rice", "spinach"]); // sorted by name
    // checkoff id stays tied to the original section even in the Other bucket
    expect(groups[2].items.find((i) => i.name === "spinach")?.section).toBe("Produce");
  });

  it("groups a fresh/perimeter item under our section when Kroger's department disagrees", () => {
    // "onion" is Produce, but Kroger matched a jarred product filed under "International".
    // We trust our Produce section for perimeter items instead of grouping it as International.
    const locations = new Map<string, ItemLocation>([
      ["onion", loc("onion", "International", 8, "Aisle 8")],
      ["rice", loc("rice", "International", 8, "Aisle 8")], // center-store: keep Kroger's dept
    ]);
    const groups = groupByAisle(list, locations);
    const byName = (n: string) => groups.find((g) => g.items.some((i) => i.name === n));
    expect(byName("onion")?.label).toBe("Produce"); // overridden to our section
    expect(byName("rice")?.label).toBe("International"); // Pantry item keeps Kroger's dept
  });

  it("orders departments by their lowest aisle number", () => {
    const locations = new Map<string, ItemLocation>([
      ["onion", loc("onion", "Produce", 30)],
      ["milk", loc("milk", "Dairy", 5)],
      ["rice", loc("rice", "Pantry", 15)],
    ]);
    const groups = groupByAisle(list, locations);
    expect(groups.map((g) => g.label)).toEqual(["Dairy", "Pantry", "Produce", "Other (not matched at Kroger)"]);
    expect(groups[3].key).toBe("other"); // spinach (no location)
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
