import { useMemo, useState } from "react";
import { recipesById } from "../lib/recipes";
import { cookedMeals } from "../lib/planner";
import { buildList, SECTION_LABELS } from "../lib/shopping";
import { normalizeForShopping } from "../lib/normalize";
import { useStore, actions } from "../lib/store";
import { exportShoppingText } from "../lib/exporter";
import { SendToMarianosModal } from "./SendToMarianosModal";

export function ShoppingView({ openSend = false }: { openSend?: boolean }) {
  const plan = useStore((s) => s.activePlan);
  const checked = useStore((s) => s.checked);
  const checkedSet = useMemo(() => new Set(checked), [checked]);
  // Opens immediately when returning from the Kroger OAuth redirect (openSend).
  const [showKroger, setShowKroger] = useState(openSend);

  const { list, mealCount } = useMemo(() => {
    const meals = cookedMeals(plan, recipesById);
    return { list: buildList(normalizeForShopping(meals)), mealCount: meals.length };
  }, [plan]);

  const itemCount = list.sections.reduce((n, s) => n + s.items.length, 0);

  if (mealCount === 0) {
    return (
      <div className="container">
        <div className="empty-state">
          Your plan is empty. Add meals in the <strong>Plan</strong> tab to build a
          shopping list.
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="row" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Shopping list</h2>
        <span className="count-pill">
          {itemCount} items · {mealCount} meals
        </span>
        <div className="spacer" />
        <button className="btn secondary small" onClick={() => exportShoppingText(list)}>
          Export
        </button>
        <button className="btn secondary small" onClick={() => window.print()}>
          🖨 Print
        </button>
        <button className="btn small" onClick={() => setShowKroger(true)}>
          🛒 Send to Mariano's
        </button>
        <button className="btn ghost small" onClick={actions.clearChecked}>
          Uncheck all
        </button>
      </div>

      <p className="muted" style={{ marginTop: 0, fontSize: "0.82rem" }}>
        Quantities are merged across the week and grouped by store section. Ingredient
        names and aisles are normalized — chopped/sliced veg are rolled up into whole
        counts, and mislabeled items are re-sectioned. Pantry staples are listed
        separately to check before shopping.
      </p>

      <div className="shop-cols">
        {list.sections.map(({ section, items }) => (
          <div className="shop-section" key={section}>
            <h3>
              {SECTION_LABELS[section].label}
              {SECTION_LABELS[section].hint && (
                <span className="section-hint">{SECTION_LABELS[section].hint}</span>
              )}
            </h3>
            {items.map(([name, qty]) => {
              const id = `${section}:${name}`;
              const isChecked = checkedSet.has(id);
              return (
                <div className={`shop-item ${isChecked ? "checked" : ""}`} key={name}>
                  <input
                    type="checkbox"
                    id={id}
                    checked={isChecked}
                    onChange={() => actions.toggleChecked(id)}
                  />
                  <label htmlFor={id}>{name}</label>
                  <span className="q">{qty}</span>
                </div>
              );
            })}
          </div>
        ))}

        {list.staples.length > 0 && (
          <div className="shop-section staples">
            <h3>Check pantry (staples)</h3>
            {list.staples.map((name) => {
              const id = `staple:${name}`;
              const isChecked = checkedSet.has(id);
              return (
                <div className={`shop-item ${isChecked ? "checked" : ""}`} key={name}>
                  <input
                    type="checkbox"
                    id={id}
                    checked={isChecked}
                    onChange={() => actions.toggleChecked(id)}
                  />
                  <label htmlFor={id}>{name}</label>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showKroger && <SendToMarianosModal list={list} onClose={() => setShowKroger(false)} />}
    </div>
  );
}
