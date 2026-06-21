import { describe, it, expect } from "vitest";
import { itemSubtotal, costLine, summarizeCost, formatMoney } from "../cost";

describe("itemSubtotal", () => {
  it("multiplies price by quantity; defaults bad quantity to 1", () => {
    expect(itemSubtotal(2.5, 2)).toBe(5);
    expect(itemSubtotal(2.5, 0)).toBe(2.5);
    expect(itemSubtotal(2.5, -1)).toBe(2.5);
    expect(itemSubtotal(2.5, NaN)).toBe(2.5);
  });
  it("returns null when there's no price", () => {
    expect(itemSubtotal(null, 3)).toBeNull();
    expect(itemSubtotal(undefined, 3)).toBeNull();
  });
});

describe("costLine", () => {
  it("floors quantity and computes subtotal", () => {
    expect(costLine("milk", 3.49, 2)).toEqual({ name: "milk", price: 3.49, quantity: 2, subtotal: 6.98 });
  });
  it("marks unpriced items", () => {
    expect(costLine("saffron", null)).toEqual({ name: "saffron", price: null, quantity: 1, subtotal: null });
  });
});

describe("summarizeCost", () => {
  it("totals priced items and splits checked vs remaining", () => {
    const lines = [
      costLine("onion", 0.99, 2), // 1.98
      costLine("milk", 3.49, 1), // 3.49
      costLine("saffron", null), // unpriced
    ];
    const checked = new Set(["onion"]);
    const s = summarizeCost(lines, (n) => checked.has(n));
    expect(s.total).toBe(5.47);
    expect(s.checkedTotal).toBe(1.98);
    expect(s.remainingTotal).toBe(3.49);
    expect(s.pricedCount).toBe(2);
    expect(s.unpricedCount).toBe(1);
  });

  it("handles an all-unpriced list", () => {
    const s = summarizeCost([costLine("x", null), costLine("y", null)], () => false);
    expect(s).toEqual({ total: 0, checkedTotal: 0, remainingTotal: 0, pricedCount: 0, unpricedCount: 2 });
  });

  it("avoids floating-point drift in the total", () => {
    const s = summarizeCost([costLine("a", 0.1, 1), costLine("b", 0.2, 1)], () => false);
    expect(s.total).toBe(0.3);
  });
});

describe("formatMoney", () => {
  it("formats to two decimals", () => {
    expect(formatMoney(5)).toBe("$5.00");
    expect(formatMoney(12.3)).toBe("$12.30");
  });
});
