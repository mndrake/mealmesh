// Canonical "keep-stocked" staple classification.
//
// The source recipe data tags staples inconsistently (the same item is `staple` in one
// recipe and a normal buy in another — e.g. baking powder 5×/4×, vanilla extract 8×/2×),
// which made items show up in BOTH the "Check pantry" bucket and a shopping section. We
// can't fix the read-only source, so normalize.ts applies this rule instead, consistently,
// to every ingredient on the shopping path.
//
// Rule: a staple is anything that files under Condiments & Spices (salt, oils, vinegars,
// sauces, dried herbs/spices — the things you keep on the shelf), PLUS a curated set of
// baking/pantry basics that file under Pantry & Dry Goods but are likewise kept stocked.
import type { Section } from "./types";

// Pantry & Dry Goods items you keep on hand (vs rice/pasta/beans you buy per recipe).
const BAKING_BASICS = new Set<string>([
  "all-purpose flour", "flour", "bread flour", "self-rising flour", "whole wheat flour",
  "white whole wheat flour", "almond flour", "cornmeal",
  "sugar", "granulated sugar", "white sugar", "brown sugar", "light brown sugar",
  "dark brown sugar", "powdered sugar", "confectioners' sugar", "superfine sugar",
  "baking powder", "baking soda", "cornstarch", "cream of tartar",
  "cocoa powder", "cacao", "active dry yeast", "instant yeast", "yeast",
  "vanilla", "vanilla extract", "honey", "maple syrup", "molasses",
]);

/** Whether an ingredient (by its shopping name + normalized section) is a keep-stocked
 *  staple. Deterministic per item, so it can never land in two places at once. */
export function isStaple(item: string, section: Section): boolean {
  if (section === "Condiments & Spices") return true;
  return BAKING_BASICS.has(item.trim().toLowerCase());
}
