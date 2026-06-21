// Estimated shopping-list cost from cached Kroger prices. Deliberately simple: each list
// item costs (package price × quantity), default 1 package, user-adjustable. Items without a
// matched price are excluded from the total and surfaced separately so the estimate is honest.
// Pure + tested; ShoppingView renders it.

export interface CostLine {
  name: string;
  price: number | null; // per-package price (null = no match / not priced yet)
  quantity: number; // packages to buy (default 1)
  subtotal: number | null; // price × quantity, or null when unpriced
}

export interface CostSummary {
  total: number; // sum of priced subtotals
  checkedTotal: number; // priced subtotals already checked off ("in cart")
  remainingTotal: number; // priced subtotals not yet checked
  pricedCount: number; // items with a price
  unpricedCount: number; // items with no price
}

/** Per-package price × quantity, or null when the item has no price. */
export function itemSubtotal(price: number | null | undefined, quantity: number): number | null {
  if (typeof price !== "number" || !Number.isFinite(price)) return null;
  const q = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  return price * q;
}

/** Build a cost line for one item. */
export function costLine(name: string, price: number | null | undefined, quantity = 1): CostLine {
  const q = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
  return { name, price: typeof price === "number" ? price : null, quantity: q, subtotal: itemSubtotal(price, q) };
}

/** Roll up cost across items, splitting checked ("in cart") from remaining. */
export function summarizeCost(lines: CostLine[], isChecked: (name: string) => boolean): CostSummary {
  let total = 0;
  let checkedTotal = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  for (const l of lines) {
    if (l.subtotal == null) {
      unpricedCount++;
      continue;
    }
    pricedCount++;
    total += l.subtotal;
    if (isChecked(l.name)) checkedTotal += l.subtotal;
  }
  return {
    total: round2(total),
    checkedTotal: round2(checkedTotal),
    remainingTotal: round2(total - checkedTotal),
    pricedCount,
    unpricedCount,
  };
}

/** "$12.34" — for display. */
export function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
