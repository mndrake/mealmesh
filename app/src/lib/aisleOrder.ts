// Reorganize the shopping list for a store walk using cached Kroger locations:
// items with a known department are grouped by it and ordered by aisle number; everything
// else falls back to its normal list section. Pure + testable; ShoppingView renders it.
import type { Section, ItemLocation } from "./types";
import { type ShoppingList, SECTION_ORDER, SECTION_LABELS } from "./shopping";

export interface AisleItem {
  name: string;
  qty: string;
  section: Section; // original list section — keeps the checkoff id stable across views
  location: ItemLocation | null;
}

export interface AisleGroup {
  key: string;
  label: string;
  items: AisleItem[];
}

const aisleOf = (i: AisleItem) => i.location?.aisleNumber ?? Number.POSITIVE_INFINITY;

export function groupByAisle(list: ShoppingList, locations: Map<string, ItemLocation>): AisleGroup[] {
  const located = new Map<string, AisleItem[]>(); // Kroger department -> items
  const fallback = new Map<Section, AisleItem[]>(); // our section -> items (no department)

  for (const { section, items } of list.sections) {
    for (const [name, qty] of items) {
      const loc = locations.get(name) ?? null;
      const item: AisleItem = { name, qty, section, location: loc };
      if (loc?.department) {
        (located.get(loc.department) ?? located.set(loc.department, []).get(loc.department)!).push(item);
      } else {
        (fallback.get(section) ?? fallback.set(section, []).get(section)!).push(item);
      }
    }
  }

  const minAisle = (items: AisleItem[]) => items.reduce((m, i) => Math.min(m, aisleOf(i)), Number.POSITIVE_INFINITY);

  const locatedGroups = [...located.entries()]
    .map(([dept, items]) => ({
      key: `dept:${dept}`,
      label: dept,
      sort: minAisle(items),
      items: [...items].sort((a, b) => aisleOf(a) - aisleOf(b) || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
    .map(({ key, label, items }): AisleGroup => ({ key, label, items }));

  const fallbackGroups = SECTION_ORDER.filter((s) => fallback.has(s)).map(
    (s): AisleGroup => ({ key: `sec:${s}`, label: SECTION_LABELS[s].label, items: fallback.get(s)! })
  );

  return [...locatedGroups, ...fallbackGroups];
}

/** Short location label for an item ("Aisle 35" preferred; else the department). */
export function locationText(loc: ItemLocation | null | undefined): string {
  if (!loc) return "";
  return loc.aisle || loc.department || "";
}

const DAY_MS = 86_400_000;

/** True when a location was fetched longer than `days` ago (store layouts drift).
 *  Items with no known fetch time (0) or no location aren't considered stale. */
export function isStale(loc: ItemLocation | null | undefined, now: number = Date.now(), days = 30): boolean {
  if (!loc || !loc.fetchedAt) return false;
  return now - loc.fetchedAt > days * DAY_MS;
}
