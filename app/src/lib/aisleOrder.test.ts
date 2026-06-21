import { describe, it, expect } from "vitest";
import { groupByAisle, locationText } from "./aisleOrder";
import type { ItemLocation } from "./types";
import type { ShoppingList } from "./shopping";

const loc = (name: string, department: string | null, aisleNumber: number | null, aisle: string | null = null): ItemLocation => ({
  name,
  department,
  aisleNumber,
  aisle,
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
  it("groups located items by department (ordered by aisle), then fallback by section", () => {
    const locations = new Map<string, ItemLocation>([
      ["onion", loc("onion", "Produce", 1, "Aisle 1")],
      ["milk", loc("milk", "Dairy", 12, "Aisle 12")],
      // spinach + rice have no location → fall back to their list section
    ]);
    const groups = groupByAisle(list, locations);
    expect(groups.map((g) => g.key)).toEqual(["dept:Produce", "dept:Dairy", "sec:Produce", "sec:Pantry & Dry Goods"]);
    expect(groups[0].items.map((i) => i.name)).toEqual(["onion"]);
    expect(groups[2].items.map((i) => i.name)).toEqual(["spinach"]); // unlocated Produce item
    // checkoff id stays tied to the original section
    expect(groups[2].items[0].section).toBe("Produce");
  });

  it("orders departments by their lowest aisle number", () => {
    const locations = new Map<string, ItemLocation>([
      ["onion", loc("onion", "Produce", 30)],
      ["milk", loc("milk", "Dairy", 5)],
      ["rice", loc("rice", "Pantry", 15)],
    ]);
    const groups = groupByAisle(list, locations);
    expect(groups.map((g) => g.label)).toEqual(["Dairy", "Pantry", "Produce", "Produce"]);
    // last "Produce" is the section-fallback group for spinach (no location)
    expect(groups[3].key).toBe("sec:Produce");
  });

  it("locationText prefers aisle, then department", () => {
    expect(locationText(loc("x", "Produce", 3, "Aisle 3"))).toBe("Aisle 3");
    expect(locationText(loc("x", "Produce", null))).toBe("Produce");
    expect(locationText(null)).toBe("");
  });
});
