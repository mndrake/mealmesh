// Combining/collapsing shopping items. Built-in synonyms fold obvious duplicates (whole milk →
// milk, hard-boiled eggs → eggs); manual merges (child name → canonical name, in the synced
// plan blob) handle everything else. A manual entry mapping a name to itself is an explicit
// "keep separate" that also cancels a built-in synonym.
//
// Merging is done by renaming ingredients to their canonical name (via buy_as) BEFORE
// buildList, so the existing aggregation sums quantities and buildList stays parity-safe.
import type { Recipe } from "./types";

/** Built-in synonyms, keyed by the lowercased shopping name → canonical shopping name. */
export const AUTO_SYNONYMS: Record<string, string> = {
  "whole milk": "milk",
  "2% milk": "milk",
  "2% reduced fat milk": "milk",
  "reduced fat milk": "milk",
  "low fat milk": "milk",
  "low-fat milk": "milk",
  "skim milk": "milk",
  "nonfat milk": "milk",
  "fat free milk": "milk",
  egg: "eggs",
  "large egg": "eggs",
  "large eggs": "eggs",
  "hard boiled egg": "eggs",
  "hard boiled eggs": "eggs",
  "hard-boiled egg": "eggs",
  "hard-boiled eggs": "eggs",
  "boiled eggs": "eggs",
};

const norm = (s: string) => s.trim().toLowerCase();

/** Resolve a shopping item name to its canonical (merged) name: manual merges win (an identity
 *  entry opts out, even of a built-in synonym), then built-in synonyms. Cycle-guarded. */
export function canonicalName(name: string, merges: Record<string, string> = {}): string {
  const seen = new Set<string>();
  let cur = name;
  while (!seen.has(cur)) {
    seen.add(cur);
    const manual = merges[cur];
    const next = manual !== undefined ? manual : AUTO_SYNONYMS[norm(cur)] ?? cur;
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

const shopName = (item: { item: string; buy_as?: string }) => item.buy_as || item.item;

/** Rename ingredients to their canonical shopping name (via buy_as) so buildList aggregates
 *  merged items together. Returns new recipe objects; inputs are untouched. */
export function applyMerges(meals: Recipe[], merges: Record<string, string>): Recipe[] {
  return meals.map((r) => ({
    ...r,
    ingredients: r.ingredients.map((i) => {
      const name = shopName(i);
      const canon = canonicalName(name, merges);
      return canon === name ? i : { ...i, buy_as: canon };
    }),
  }));
}

/** For each canonical name, the distinct original shopping names that fold into it (excluding
 *  the canonical itself). Run on the PRE-merge meals. Drives the "(+ whole milk)" hint + unmerge. */
export function mergedFrom(meals: Recipe[], merges: Record<string, string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of meals) {
    for (const i of r.ingredients ?? []) {
      if (i.exclude_from_shopping) continue;
      const name = shopName(i);
      const canon = canonicalName(name, merges);
      if (canon === name) continue;
      const arr = out.get(canon) ?? [];
      if (!arr.includes(name)) arr.push(name);
      out.set(canon, arr);
    }
  }
  return out;
}
