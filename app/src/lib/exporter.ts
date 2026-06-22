// Export helpers — download plans / shopping lists / full app state as files.
import type { Plan, PlanDay, MealRef } from "./types";
import { allRecipesById } from "./allRecipes";
import { buildList, type ShoppingList } from "./shopping";
import { getState } from "./store";
import { cookedMeals } from "./planner";
import { prepPlan } from "./prep";
import { planEase } from "./ease";
import { dayTotals } from "./nutrition";

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

/** Gemini-style printable plan: weekend prep blueprint, per-day menu with net carbs,
 *  and the aggregated shopping list. A single fridge-postable document. */
export function exportPlanMarkdown(plan: Plan) {
  const byId = allRecipesById();
  const prep = prepPlan(plan, byId);
  const ease = planEase(cookedMeals(plan, byId));
  const list = buildList(cookedMeals(plan, byId));
  const today = new Date().toISOString().slice(0, 10);

  const L: string[] = [];
  L.push("# MealMesh meal plan", "");
  L.push(`_Generated ${today} · ${ease.paletteSize} ingredients to buy · net carbs shown per day_`, "");

  if (prep.prepAhead.length) {
    L.push("## Weekend prep — make once, eat all week", "");
    for (const p of prep.prepAhead) {
      L.push(`- **${p.title}** — batch-cook once, covers ${p.days} ${p.slots.join(" & ")} ${p.days === 1 ? "day" : "days"}`);
    }
    if (prep.fresh.length) {
      L.push("", `_Cooked fresh on the day: ${prep.fresh.map((f) => f.title).join(", ")}_`);
    }
    L.push("");
  }

  L.push("## The week", "");
  for (const d of plan) {
    const net = dayTotals(d, byId).netCarbs;
    L.push(`### ${d.day} — ~${net}g net carbs`);
    L.push(`- Breakfast: ${mealLabel(d.breakfast)}`);
    L.push(`- Lunch: ${mealLabel(d.lunch)}`);
    L.push(`- Dinner: ${mealLabel(d.dinner)}`);
    L.push(`- Snack: ${mealLabel(d.snack)}`, "");
  }

  L.push(`## Shopping list (${ease.paletteSize} ingredients)`, "");
  for (const { section, items } of list.sections) {
    L.push(`### ${section}`);
    for (const [name, qty] of items) L.push(`- [ ] ${name} — ${qty}`);
    L.push("");
  }
  if (list.staples.length) {
    L.push("### Pantry staples (check what you're low on)");
    for (const s of list.staples) L.push(`- [ ] ${s}`);
    L.push("");
  }

  download("mealmesh-plan.md", L.join("\n"), "text/markdown");
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
    lines.push("Pantry staples (check what you're low on)");
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
