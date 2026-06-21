// Reorganize the shopping list for a store walk using cached Kroger locations:
// items with a known department are grouped by it and ordered by aisle number; everything
// else falls back to its normal list section. Pure + testable; ShoppingView renders it.
import type { Section, ItemLocation } from "./types";
import type { ShoppingList } from "./shopping";
import { SECTION_LABELS } from "./shopping";
import { krogerDepartmentToSection } from "./krogerSections";

// Fresh/perimeter sections occupy distinct store areas (produce wall, meat/dairy cases,
// freezers, bakery). For these we trust our curated section over Kroger's product department,
// which is often wrong for fresh items (e.g. a jarred "roasted red pepper" filed under
// International matched for fresh "red bell pepper"). Center-store items keep Kroger's dept.
const PERIMETER: ReadonlySet<Section> = new Set<Section>([
  "Produce",
  "Meat & Poultry",
  "Dairy & Eggs",
  "Frozen",
  "Bakery",
]);

/** The department label to group an item under: Kroger's product department, except for
 *  fresh/perimeter items where Kroger disagrees with our section — then use our section. */
function groupDept(item: AisleItem): string | null {
  const dept = item.location?.department ?? null;
  if (!dept) return null; // not matched → handled as "Other" by the caller (unchanged)
  if (PERIMETER.has(item.section) && krogerDepartmentToSection(dept) !== item.section) {
    return SECTION_LABELS[item.section].label;
  }
  return dept;
}

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
  const other: AisleItem[] = []; // no Kroger department (not matched / no data)

  for (const { section, items } of list.sections) {
    for (const [name, qty] of items) {
      const loc = locations.get(name) ?? null;
      const item: AisleItem = { name, qty, section, location: loc };
      const dept = groupDept(item);
      if (dept) {
        (located.get(dept) ?? located.set(dept, []).get(dept)!).push(item);
      } else {
        other.push(item);
      }
    }
  }

  const minAisle = (items: AisleItem[]) => items.reduce((m, i) => Math.min(m, aisleOf(i)), Number.POSITIVE_INFINITY);

  // Pure Kroger grouping: by department, ordered by lowest aisle number. Items Kroger didn't
  // place go in a single "Other" bucket (no fallback to our recipe-derived sections).
  const locatedGroups = [...located.entries()]
    .map(([dept, items]) => ({
      key: `dept:${dept}`,
      label: dept,
      sort: minAisle(items),
      items: [...items].sort((a, b) => aisleOf(a) - aisleOf(b) || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
    .map(({ key, label, items }): AisleGroup => ({ key, label, items }));

  const otherGroup: AisleGroup[] = other.length
    ? [{ key: "other", label: "Other (not matched at Kroger)", items: [...other].sort((a, b) => a.name.localeCompare(b.name)) }]
    : [];

  return [...locatedGroups, ...otherGroup];
}

/** Short location label for an item ("Aisle 35" preferred; else the department). */
export function locationText(loc: ItemLocation | null | undefined): string {
  if (!loc) return "";
  return loc.aisle || loc.department || "";
}

/** Finer in-store placement ("Bay 3 · Shelf 2 · L"), from the partial Kroger data. */
export function shelfText(loc: ItemLocation | null | undefined): string {
  if (!loc) return "";
  const parts: string[] = [];
  if (loc.bay) parts.push(`Bay ${loc.bay}`);
  if (loc.shelf) parts.push(`Shelf ${loc.shelf}`);
  if (loc.side) parts.push(loc.side);
  return parts.join(" · ");
}

const num = (v: string | null | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};

/** Store-walk view: group by actual aisle, ordered by aisle number, and within each aisle by
 *  bay then shelf — the path you'd walk. Unmapped items go in one bucket at the end. */
export function groupByAisleWalk(list: ShoppingList, locations: Map<string, ItemLocation>): AisleGroup[] {
  const byAisle = new Map<string, AisleItem[]>();
  const other: AisleItem[] = [];
  for (const { section, items } of list.sections) {
    for (const [name, qty] of items) {
      const loc = locations.get(name) ?? null;
      const item: AisleItem = { name, qty, section, location: loc };
      const label = loc?.aisle || (loc?.aisleNumber != null ? `Aisle ${loc.aisleNumber}` : null);
      if (label) (byAisle.get(label) ?? byAisle.set(label, []).get(label)!).push(item);
      else other.push(item);
    }
  }
  const walkSort = (a: AisleItem, b: AisleItem) =>
    num(a.location?.bay) - num(b.location?.bay) ||
    num(a.location?.shelf) - num(b.location?.shelf) ||
    a.name.localeCompare(b.name);

  const groups = [...byAisle.entries()]
    .map(([label, items]) => ({
      key: `aisle:${label}`,
      label,
      sort: items.reduce((m, i) => Math.min(m, i.location?.aisleNumber ?? Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY),
      items: [...items].sort(walkSort),
    }))
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
    .map(({ key, label, items }): AisleGroup => ({ key, label, items }));

  const otherGroup: AisleGroup[] = other.length
    ? [{ key: "other", label: "Not mapped at your store", items: [...other].sort((a, b) => a.name.localeCompare(b.name)) }]
    : [];
  return [...groups, ...otherGroup];
}

const DAY_MS = 86_400_000;

/** True when a location was fetched longer than `days` ago (store layouts drift).
 *  Items with no known fetch time (0) or no location aren't considered stale. */
export function isStale(loc: ItemLocation | null | undefined, now: number = Date.now(), days = 30): boolean {
  if (!loc || !loc.fetchedAt) return false;
  return now - loc.fetchedAt > days * DAY_MS;
}
