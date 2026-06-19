import { useMemo } from "react";
import { recipesById } from "../lib/recipes";
import { cookedMeals } from "../lib/planner";
import { buildList } from "../lib/shopping";
import { useStore, actions } from "../lib/store";
import { exportShoppingText } from "../lib/exporter";

export function ShoppingView() {
  const plan = useStore((s) => s.activePlan);
  const checked = useStore((s) => s.checked);
  const checkedSet = useMemo(() => new Set(checked), [checked]);

  const { list, mealCount } = useMemo(() => {
    const meals = cookedMeals(plan, recipesById);
    return { list: buildList(meals), mealCount: meals.length };
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
        <button className="btn ghost small" onClick={actions.clearChecked}>
          Uncheck all
        </button>
      </div>

      <p className="muted" style={{ marginTop: 0, fontSize: "0.82rem" }}>
        Quantities are merged across the week and grouped by store section. Pantry
        staples are listed separately to check before shopping.
      </p>

      <div className="shop-cols">
        {list.sections.map(({ section, items }) => (
          <div className="shop-section" key={section}>
            <h3>{section}</h3>
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
    </div>
  );
}
