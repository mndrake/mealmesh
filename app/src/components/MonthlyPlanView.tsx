import { useMemo, useState } from "react";
import { rawRecipes } from "../lib/recipes";
import { useAllRecipesById } from "../lib/allRecipes";
import { useStore } from "../lib/store";
import { buildMonthlyPlan } from "../lib/monthly";
import { cookedMeals } from "../lib/planner";
import { prepPlan } from "../lib/prep";
import { planEase } from "../lib/ease";
import { dayTotals } from "../lib/nutrition";
import { buildList, SECTION_LABELS } from "../lib/shopping";
import { exportMonthlyMarkdown } from "../lib/exporter";

const CONSTRAINTS = ["diabetic-friendly", "vegetarian", "low-carb", "high-protein"];

export function MonthlyPlanView() {
  const byId = useAllRecipesById();
  const userRecipes = useStore((s) => s.userRecipes);
  const [require, setRequire] = useState<string[]>([]);
  const [household, setHousehold] = useState(2);
  const [target, setTarget] = useState(100);
  const [activeWeek, setActiveWeek] = useState(0);

  // Generated/imported recipes (simpler, palette-fitting) are eligible alongside the
  // bundled set — ease mode prefers whichever adds the fewest new ingredients, so adding
  // simple generated recipes makes the monthly plan simpler. (The parity-locked default
  // weekly planner still builds from the bundled set only.)
  const pool = useMemo(() => [...userRecipes, ...rawRecipes], [userRecipes]);

  const monthly = useMemo(
    () =>
      buildMonthlyPlan(pool, {
        requireTags: require,
        householdSize: household,
        netCarbTargetPerDay: target,
      }),
    [pool, require, household, target]
  );

  // Pantry staples shared across the whole month (buy once); union of both weeks.
  const monthlyPantry = useMemo(() => {
    const s = new Set<string>();
    for (const w of monthly.weeks) {
      for (const item of buildList(cookedMeals(w.plan, byId)).staples) s.add(item);
    }
    return [...s].sort();
  }, [monthly, byId]);

  const week = monthly.weeks[activeWeek];
  const meals = useMemo(() => cookedMeals(week.plan, byId), [week, byId]);
  const ease = useMemo(() => planEase(meals), [meals]);
  const prep = useMemo(() => prepPlan(week.plan, byId), [week, byId]);
  const list = useMemo(() => buildList(meals), [meals]);

  const title = (id: string) => byId.get(id)?.title ?? id;

  return (
    <div className="container">
      <div className="row" style={{ marginBottom: 14, alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Monthly plan</h2>
        <span className="muted" style={{ fontSize: "0.8rem", marginLeft: 8 }}>
          A rotating two-week template — cook once on the weekend, eat easy all week.
        </span>
        <div className="spacer" />
        <button
          className="btn secondary small"
          onClick={() => exportMonthlyMarkdown(monthly)}
          title="Download the whole month as a printable document"
        >
          📄 Month doc
        </button>
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {CONSTRAINTS.map((c) => (
          <button
            key={c}
            className={`toggle ${require.includes(c) ? "on" : ""}`}
            onClick={() =>
              setRequire(require.includes(c) ? require.filter((x) => x !== c) : [...require, c])
            }
          >
            {c}
          </button>
        ))}
        <span
          className="muted"
          style={{ marginLeft: 8, fontSize: "0.8rem" }}
          title="Recorded on the plan; quantities currently reflect each recipe's yield (per-person scaling is coming)"
        >
          People
        </span>
        <input
          type="number"
          min={1}
          style={{ width: 56 }}
          value={household}
          onChange={(e) => setHousehold(Math.max(1, Number(e.target.value) || 1))}
        />
        <span className="muted" style={{ fontSize: "0.8rem" }}>Net carbs/day ≤</span>
        <input
          type="number"
          min={0}
          style={{ width: 64 }}
          value={target}
          onChange={(e) => setTarget(Math.max(0, Number(e.target.value) || 0))}
        />
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 14 }}>
        {monthly.weeks.map((w, i) => (
          <button
            key={w.label}
            className={`toggle ${i === activeWeek ? "on" : ""}`}
            onClick={() => setActiveWeek(i)}
          >
            {w.label}
          </button>
        ))}
        <span className="muted" style={{ fontSize: "0.78rem", alignSelf: "center" }}>
          {ease.paletteSize} ingredients to buy this week
        </span>
      </div>

      {prep.prepAhead.length > 0 && (
        <div className="filters" style={{ display: "grid", gap: 6, marginBottom: 14 }}>
          <strong>🧊 Weekend prep — make once, eat all week</strong>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {prep.prepAhead.map((p) => (
              <li key={p.recipeId}>
                <b>{p.title}</b> — batch-cook once, covers {p.days} {p.slots.join(" & ")}{" "}
                {p.days === 1 ? "day" : "days"}
              </li>
            ))}
          </ul>
          {prep.fresh.length > 0 && (
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              Cooked fresh on the day: {prep.fresh.map((f) => f.title).join(", ")}
            </span>
          )}
        </div>
      )}

      <div className="month-grid" style={{ display: "grid", gap: 8, marginBottom: 18 }}>
        {week.plan.map((d) => {
          const net = dayTotals(d, byId).netCarbs;
          const over = net > target;
          return (
            <div
              key={d.day}
              className="card"
              style={{ padding: "10px 12px", display: "grid", gap: 2 }}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{d.day}</strong>
                <span
                  className={over ? "est" : "muted"}
                  title={over ? `Over your ${target}g/day target` : "Within target"}
                  style={{ fontSize: "0.78rem" }}
                >
                  ~{net}g net carbs{over ? " ⚠" : ""}
                </span>
              </div>
              <div className="muted" style={{ fontSize: "0.84rem" }}>
                <b>B:</b> {mealText(d.breakfast, title)} · <b>L:</b> {mealText(d.lunch, title)} ·{" "}
                <b>D:</b> {mealText(d.dinner, title)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="row" style={{ gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 280px" }}>
          <h3 style={{ marginTop: 0 }}>{week.label} — replenish shopping</h3>
          {list.sections.map(({ section, items }) => (
            <div key={section} style={{ marginBottom: 10 }}>
              <strong>{SECTION_LABELS[section].label}</strong>
              <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                {items.map(([name, qty]) => (
                  <li key={name}>
                    {name} — {qty}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ flex: "1 1 220px" }}>
          <h3 style={{ marginTop: 0 }}>Monthly pantry (buy once)</h3>
          <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
            {monthlyPantry.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function mealText(
  ref: { id: string; leftover: boolean } | string | null,
  title: (id: string) => string
): string {
  if (!ref) return "—";
  if (typeof ref === "string") return ref;
  return title(ref.id) + (ref.leftover ? " (leftover)" : "");
}
