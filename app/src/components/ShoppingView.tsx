import { useMemo, useState } from "react";
import type { Section } from "../lib/types";
import { useAllRecipesById } from "../lib/allRecipes";
import { cookedMeals } from "../lib/planner";
import { buildList, SECTION_LABELS } from "../lib/shopping";
import { normalizeForShopping } from "../lib/normalize";
import { groupByAisle, locationText, isStale } from "../lib/aisleOrder";
import { formatCookedOn, todayIso } from "../lib/history";
import { useStore, actions } from "../lib/store";
import { krogerClient } from "../lib/krogerClient";
import { exportShoppingText } from "../lib/exporter";
import { SendToMarianosModal } from "./SendToMarianosModal";

const STALE_DAYS = 30;
const fmtDate = (ms: number) => formatCookedOn(todayIso(new Date(ms)));

export function ShoppingView({ openSend = false }: { openSend?: boolean }) {
  const plan = useStore((s) => s.activePlan);
  const recipesById = useAllRecipesById();
  const checked = useStore((s) => s.checked);
  const itemLocations = useStore((s) => s.itemLocations);
  const checkedSet = useMemo(() => new Set(checked), [checked]);
  const locMap = useMemo(() => new Map(itemLocations.map((l) => [l.name, l])), [itemLocations]);
  // Opens immediately when returning from the Kroger OAuth redirect (openSend).
  const [showKroger, setShowKroger] = useState(openSend);
  const [byAisle, setByAisle] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { list, mealCount } = useMemo(() => {
    const meals = cookedMeals(plan, recipesById);
    return { list: buildList(normalizeForShopping(meals)), mealCount: meals.length };
  }, [plan, recipesById]);

  const itemCount = list.sections.reduce((n, s) => n + s.items.length, 0);
  // Only offer aisle order when some current item actually has location data.
  const hasLocations = useMemo(
    () => list.sections.some((s) => s.items.some(([name]) => locMap.get(name)?.department || locMap.get(name)?.aisle)),
    [list, locMap]
  );
  // Most recent fetch time among located items on the current list (for the "as of" note).
  const lastFetched = useMemo(() => {
    let max = 0;
    for (const s of list.sections) for (const [name] of s.items) {
      const f = locMap.get(name)?.fetchedAt ?? 0;
      if (f > max) max = f;
    }
    return max;
  }, [list, locMap]);
  const aisleGroups = useMemo(
    () => (byAisle && hasLocations ? groupByAisle(list, locMap) : null),
    [byAisle, hasLocations, list, locMap]
  );
  // Located items whose aisle info is older than the staleness threshold.
  const staleCount = useMemo(
    () =>
      list.sections.reduce(
        (n, s) => n + s.items.filter(([name]) => isStale(locMap.get(name), Date.now(), STALE_DAYS)).length,
        0
      ),
    [list, locMap]
  );

  /** Re-fetch aisle/location info for the current list from Mariano's. Silent when already
   *  connected with a store; otherwise falls back to the guided Send flow which sets those up. */
  async function refreshAisles() {
    const items = list.sections.flatMap((s) => s.items).map(([name, displayQty]) => ({ name, displayQty }));
    setRefreshing(true);
    try {
      const { rows } = await krogerClient.match(items, true);
      const now = Date.now();
      const locs = rows
        .filter((r) => r.matched && (r.matched.department || r.matched.aisle))
        .map((r) => ({
          name: r.listName,
          aisle: r.matched!.aisle,
          aisleNumber: r.matched!.aisleNumber,
          department: r.matched!.department,
          fetchedAt: now,
        }));
      if (locs.length) actions.saveItemLocations(locs);
    } catch {
      setShowKroger(true); // not connected / no store yet — the modal handles setup
    } finally {
      setRefreshing(false);
    }
  }

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

  function Item({ name, qty, section }: { name: string; qty?: string; section: Section | "staple" }) {
    const id = `${section}:${name}`;
    const isChecked = checkedSet.has(id);
    const loc = locMap.get(name);
    const where = locationText(loc);
    const stale = isStale(loc, Date.now(), STALE_DAYS);
    return (
      <div className={`shop-item ${isChecked ? "checked" : ""}`}>
        <input type="checkbox" id={id} checked={isChecked} onChange={() => actions.toggleChecked(id)} />
        <label htmlFor={id}>{name}</label>
        {where && (
          <span
            className={`shop-loc ${stale ? "stale" : ""}`}
            title={loc?.fetchedAt ? `Aisle info fetched ${fmtDate(loc.fetchedAt)}${stale ? " — may be stale" : ""}` : undefined}
          >
            📍 {where}
            {stale ? " ⚠" : ""}
          </span>
        )}
        {qty && <span className="q">{qty}</span>}
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
        <button
          className={`btn secondary small ${byAisle ? "on" : ""}`}
          onClick={() => setByAisle((v) => !v)}
          disabled={!hasLocations}
          title={
            hasLocations
              ? "Organize by store aisle (from Kroger)"
              : "Send your list to Mariano's first to fetch aisle info"
          }
        >
          🧭 Aisle order
        </button>
        {hasLocations && (
          <button
            className="btn secondary small"
            onClick={refreshAisles}
            disabled={refreshing}
            title="Re-fetch aisle / location info from Mariano's"
          >
            {refreshing ? "↻ Refreshing…" : `↻ Refresh aisles${staleCount ? ` (${staleCount} stale)` : ""}`}
          </button>
        )}
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
        {aisleGroups
          ? `Organized by Kroger department, ordered by aisle${lastFetched ? ` (aisle info as of ${fmtDate(lastFetched)})` : ""}. Items Kroger didn't match are in "Other" at the end; aisle coverage is partial.`
          : `Quantities are merged across the week and grouped by store section.${lastFetched ? ` Aisle info shown where known (as of ${fmtDate(lastFetched)}).` : ""} Pantry staples are listed separately to check before shopping.`}
      </p>

      <div className="shop-cols">
        {aisleGroups
          ? aisleGroups.map((g) => (
              <div className="shop-section" key={g.key}>
                <h3>{g.label}</h3>
                {g.items.map((it) => (
                  <Item key={it.name} name={it.name} qty={it.qty} section={it.section} />
                ))}
              </div>
            ))
          : list.sections.map(({ section, items }) => (
              <div className="shop-section" key={section}>
                <h3>
                  {SECTION_LABELS[section].label}
                  {SECTION_LABELS[section].hint && (
                    <span className="section-hint">{SECTION_LABELS[section].hint}</span>
                  )}
                </h3>
                {items.map(([name, qty]) => (
                  <Item key={name} name={name} qty={qty} section={section} />
                ))}
              </div>
            ))}

        {list.staples.length > 0 && (
          <div className="shop-section staples">
            <h3>Check pantry (staples)</h3>
            {list.staples.map((name) => (
              <Item key={name} name={name} section="staple" />
            ))}
          </div>
        )}
      </div>

      {showKroger && <SendToMarianosModal list={list} onClose={() => setShowKroger(false)} />}
    </div>
  );
}
