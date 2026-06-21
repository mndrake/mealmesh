// Cross-check the shopping list's section against the Kroger department of a matched
// product (used in the Send-to-Mariano's review). Conservative on purpose: only map
// departments we're confident about, so an unknown/ambiguous Kroger department never
// produces a false "mismatch" flag.
import type { Section } from "./types";

export function krogerDepartmentToSection(department: string | null | undefined): Section | null {
  if (!department) return null;
  const d = department.toLowerCase();
  if (d.includes("produce")) return "Produce";
  if (d.includes("seafood") || d.includes("meat") || d.includes("poultry")) return "Meat & Poultry";
  if (d.includes("dairy") || d.includes("egg")) return "Dairy & Eggs";
  if (d.includes("frozen")) return "Frozen";
  if (d.includes("bakery") || d.includes("bread")) return "Bakery";
  return null;
}

/** The Kroger section when it confidently differs from the list section, else null. */
export function sectionMismatch(
  listSection: Section | null | undefined,
  department: string | null | undefined
): Section | null {
  const kroger = krogerDepartmentToSection(department);
  if (!kroger || !listSection) return null;
  return kroger !== listSection ? kroger : null;
}
