// Port of recipe-repo/build/shopping.py — aggregate structured ingredients from a
// set of meals into an aisle-grouped shopping list. Kept faithful to the original
// (unit families, rounding, sort order) and asserted against golden fixtures.
import type { Recipe, Ingredient, Section } from "./types";

export const SECTION_ORDER: Section[] = [
  "Produce",
  "Meat & Poultry",
  "Dairy & Eggs",
  "Bakery",
  "Pantry & Dry Goods",
  "Condiments & Spices",
];

const VOL_TO_TSP: Record<string, number> = { tsp: 1, tbsp: 3, cup: 48, "fl oz": 6 };
const MASS_TO_OZ: Record<string, number> = { oz: 1, lb: 16 };

function key(ing: Ingredient): string {
  return ing.buy_as || ing.item;
}

// Round to 2 decimals using round-half-to-even (banker's rounding), matching
// Python's round() so shopping.py:_trim parity holds (e.g. 0.625 -> 0.62).
function trim(x: number): number {
  const scaled = x * 100;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const EPS = 1e-9;
  let r: number;
  if (diff > 0.5 + EPS) r = floor + 1;
  else if (diff < 0.5 - EPS) r = floor;
  else r = floor % 2 === 0 ? floor : floor + 1; // exact tie -> nearest even
  return r / 100;
}

function fmt(
  volTsp: number,
  massOz: number,
  counts: Map<string, number>,
  noqty: string[]
): string {
  const parts: string[] = [];
  if (volTsp) {
    const cups = volTsp / 48;
    parts.push(cups >= 0.25 ? `${trim(cups)} cup` : `${trim(volTsp / 3)} tbsp`);
  }
  if (massOz) {
    parts.push(massOz >= 16 ? `${trim(massOz / 16)} lb` : `${trim(massOz)} oz`);
  }
  for (const u of [...counts.keys()].sort()) {
    parts.push(`${trim(counts.get(u)!)} ${u}`.trim());
  }
  for (const u of [...noqty].sort()) {
    parts.push(`+ ${u}`);
  }
  return parts.length ? parts.join(", ") : "as needed";
}

export interface ShoppingList {
  /** Aisle-ordered sections, each a list of [name, quantity] pairs. */
  sections: { section: Section; items: [string, string][] }[];
  /** Staple item names held aside ("check pantry"). */
  staples: string[];
}

type Acc = {
  vol: number;
  mass: number;
  counts: Map<string, number>;
  noqty: Set<string>;
};

/**
 * meals: recipes, each counted once (= cooked once).
 * Returns aisle-grouped sections + the separate staples list.
 */
export function buildList(meals: Recipe[]): ShoppingList {
  const acc = new Map<string, Acc>();
  const staples = new Set<string>();
  const sectionsFor = new Map<string, Section>();

  const getAcc = (name: string): Acc => {
    let a = acc.get(name);
    if (!a) {
      a = { vol: 0, mass: 0, counts: new Map(), noqty: new Set() };
      acc.set(name, a);
    }
    return a;
  };

  for (const r of meals) {
    for (const ing of r.ingredients ?? []) {
      if (ing.exclude_from_shopping) continue;
      const name = key(ing);
      if (ing.staple) {
        staples.add(name);
        continue;
      }
      sectionsFor.set(name, ing.section);
      const q = ing.qty;
      const u = ing.unit ?? "";
      const a = getAcc(name);
      if (q === null || q === undefined || u === "to taste" || u === "pinch") {
        a.noqty.add(u || "some");
      } else if (u in VOL_TO_TSP) {
        a.vol += q * VOL_TO_TSP[u];
      } else if (u in MASS_TO_OZ) {
        a.mass += q * MASS_TO_OZ[u];
      } else {
        a.counts.set(u, (a.counts.get(u) ?? 0) + q);
      }
    }
  }

  const sections = new Map<Section, [string, string][]>();
  for (const name of [...acc.keys()].sort()) {
    const a = acc.get(name)!;
    const noqty = [...a.noqty].filter((u) => u !== "some");
    const qty = fmt(a.vol, a.mass, a.counts, noqty);
    const sec = sectionsFor.get(name)!;
    if (!sections.has(sec)) sections.set(sec, []);
    sections.get(sec)!.push([name, qty]);
  }

  const ordered = SECTION_ORDER.filter((s) => sections.has(s)).map((s) => ({
    section: s,
    items: sections.get(s)!,
  }));

  return { sections: ordered, staples: [...staples].sort() };
}
