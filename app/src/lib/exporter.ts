// Export helpers — download plans / shopping lists / full app state as files.
import type { Plan, PlanDay, MealRef } from "./types";
import { allRecipesById } from "./allRecipes";
import type { ShoppingList } from "./shopping";
import { getState } from "./store";

function download(filename: string, text: string, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function mealLabel(ref: PlanDay[keyof PlanDay]): string {
  if (!ref) return "—";
  if (typeof ref === "string") return ref;
  const r = allRecipesById().get((ref as MealRef).id);
  const lo = (ref as MealRef).leftover ? " (leftover)" : "";
  return (r?.title ?? ref.id) + lo;
}

/** Human-readable plan plus the raw JSON, so a re-import can restore it exactly. */
export function exportPlanJson(plan: Plan) {
  const readable = plan.map((d) => ({
    day: d.day,
    breakfast: mealLabel(d.breakfast),
    lunch: mealLabel(d.lunch),
    dinner: mealLabel(d.dinner),
    snack: mealLabel(d.snack),
  }));
  download(
    "mealmesh-plan.json",
    JSON.stringify({ exportedAt: new Date().toISOString(), readable, plan }, null, 2)
  );
}

export function exportShoppingText(
  list: ShoppingList,
  cost?: { subtotalOf?: Map<string, number | null>; total?: number }
) {
  const money = (n: number) => `$${n.toFixed(2)}`;
  const priced = (name: string) => {
    const s = cost?.subtotalOf?.get(name);
    return typeof s === "number" ? `  (${money(s)})` : "";
  };
  const lines: string[] = ["MealMesh shopping list", ""];
  for (const { section, items } of list.sections) {
    lines.push(section);
    for (const [name, qty] of items) lines.push(`  [ ] ${name} — ${qty}${priced(name)}`);
    lines.push("");
  }
  if (list.staples.length) {
    lines.push("Check pantry (staples)");
    for (const s of list.staples) lines.push(`  [ ] ${s}`);
    lines.push("");
  }
  if (typeof cost?.total === "number" && cost.total > 0) {
    lines.push(`Estimated total: ${money(cost.total)} (per-package prices; an estimate)`);
  }
  download("mealmesh-shopping.txt", lines.join("\n"), "text/plain");
}

/** Whole-app backup: plans, favorites, checkoffs. */
export function exportAllState() {
  download("mealmesh-backup.json", JSON.stringify(getState(), null, 2));
}
