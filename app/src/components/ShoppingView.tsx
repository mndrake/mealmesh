import { useMemo, useState } from "react";
import type { Section } from "../lib/types";
import { useAllRecipesById } from "../lib/allRecipes";
import { cookedMeals } from "../lib/planner";
import { buildList, SECTION_LABELS } from "../lib/shopping";
import { normalizeForShopping } from "../lib/normalize";
import { groupByAisle, locationText, isStale } from "../lib/aisleOrder";
import { costLine, summarizeCost, formatMoney } from "../lib/cost";
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
  // null = auto (aisle order once we have locations); true/false = explicit user choice.
  const [byAisleChoice, setByAisleChoice] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Package quantity is set/persisted in the "Review products & prices" step (the Send modal),
  // not edited inline here — the list is the clean in-store checklist.
  const getQty = (name: string) => locMap.get(name)?.quantity ?? 1;

  const { list, mealCount } = useMemo(() => {
    const meals = cookedMeals(plan, recipesById);
    return { list: buildList(normalizeForShopping(meals)), mealCount: meals.length };
  }, [plan, recipesById]);

  const itemCount = list.sections.reduce((n, s) => n + s.items.length, 0);
  const hasLocations = useMemo(
    () => list.sections.some((s) => s.items.some(([name]) => locMap.get(name)?.department || locMap.get(name)?.aisle)),
    [list, locMap]
  );
  const byAisle = byAisleChoice ?? hasLocations; // default to aisle order once we have data
  const hasPrices = useMemo(
    () => list.sections.some((s) => s.items.some(([name]) => typeof locMap.get(name)?.price === "number")),
    [list, locMap]
  );

  // Cost estimate across the (non-staple) list, split into in-cart vs remaining.
  const checkedNames = useMemo(() => {
    const set = new Set<string>();
    for (const { section, items } of list.sections) for (const [name] of items) if (checkedSet.has(`${section}:${name}`)) set.add(name);
    return set;
  }, [list, checkedSet]);
  const cost = useMemo(() => {
    const lines = list.sections.flatMap((s) => s.items.map(([name]) => costLine(name, locMap.get(name)?.price ?? null, locMap.get(name)?.quantity ?? 1)));
    return summarizeCost(lines, (n) => checkedNames.has(n));
  }, [list, locMap, checkedNames]);

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
  const staleCount = useMemo(
    () =>
      list.sections.reduce(
        (n, s) => n + s.items.filter(([name]) => isStale(locMap.get(name), Date.now(), STALE_DAYS)).length,
        0
      ),
    [list, locMap]
  );

  /** Fetch price + aisle/department for the current list from Mariano's (server-cached) and
   *  persist it, so the list shows cost and organizes by aisle. Falls back to the guided Send
   *  flow when not connected / no store chosen yet. */
  async function updatePrices() {
    const items = list.sections.flatMap((s) => s.items).map(([name, displayQty]) => ({ name, displayQty }));
    if (!items.length) return;
    setRefreshing(true);
    try {
      const { rows } = await krogerClient.match(items, true);
      const now = Date.now();
      const locs = rows
        .filter((r) => r.matched)
        .map((r) => ({
          name: r.listName,
          aisle: r.matched!.aisle,
          aisleNumber: r.matched!.aisleNumber,
          department: r.matched!.department,
          price: r.matched!.price,
          product: r.matched!.description,
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

  function Item({ name, qty: recipeQty, section }: { name: string; qty?: string; section: Section | "staple" }) {
    const id = `${section}:${name}`;
    const isChecked = checkedSet.has(id);
    const loc = locMap.get(name);
    const where = locationText(loc);
    const stale = isStale(loc, Date.now(), STALE_DAYS);
    const price = section !== "staple" ? loc?.price ?? null : null;
    const packages = loc?.quantity ?? 1;
    const hasSub = Boolean(where || recipeQty || price != null);
    return (
      <div className={`shop-item ${isChecked ? "checked" : ""}`}>
        <input type="checkbox" id={id} checked={isChecked} onChange={() => actions.toggleChecked(id)} />
        <div className="shop-main">
          <label htmlFor={id}>{name}</label>
          {hasSub && (
            <div className="shop-sub">
              {where && (
                <span
                  className={`shop-loc ${stale ? "stale" : ""}`}
                  title={loc?.fetchedAt ? `Aisle info fetched ${fmtDate(loc.fetchedAt)}${stale ? " — may be stale" : ""}` : undefined}
                >
                  📍 {where}
                  {stale ? " ⚠" : ""}
                </span>
              )}
              {recipeQty && <span className="q">{recipeQty}</span>}
              {price != null && (
                <span className="shop-price" title={loc?.product ? `Priced as: ${loc.product}${packages > 1 ? ` × ${packages}` : ""}` : undefined}>
                  {packages > 1 ? `${packages}× ` : ""}
                  {formatMoney(price * packages)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  const subtotalMap = new Map(
    list.sections.flatMap((s) => s.items.map(([name]) => [name, costLine(name, locMap.get(name)?.price ?? null, getQty(name)).subtotal] as const))
  );

  return (
    <div className="container">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>Shopping list</h2>
        <span className="count-pill">
          {itemCount} items · {mealCount} meals
        </span>
        {hasPrices && (
          <span className="count-pill cost" title={`${cost.pricedCount} of ${itemCount} items priced`}>
            ~{formatMoney(cost.total)} est.
          </span>
        )}
        <div className="spacer" />
        <button
          className={`btn secondary small ${byAisle ? "on" : ""}`}
          onClick={() => setByAisleChoice(!byAisle)}
          disabled={!hasLocations}
          title={hasLocations ? "Organize by store aisle (from Kroger)" : "Update prices & aisles first"}
        >
          🧭 Aisle order
        </button>
        <button
          className="btn secondary small"
          onClick={updatePrices}
          disabled={refreshing}
          title="Fetch prices + aisle info for this list from Mariano's"
        >
          {refreshing ? "↻ Updating…" : hasPrices || hasLocations ? `↻ Update prices & aisles${staleCount ? ` (${staleCount} stale)` : ""}` : "💲 Get prices & aisles"}
        </button>
        <button className="btn secondary small" onClick={() => exportShoppingText(list, { subtotalOf: subtotalMap, total: cost.total })}>
          Export
        </button>
        <button className="btn secondary small" onClick={() => window.print()}>
          🖨 Print
        </button>
        <button className="btn small" onClick={() => setShowKroger(true)} title="Swap products, set quantities, and (optionally) send to your Mariano's cart">
          🛒 Review &amp; send
        </button>
        <button className="btn ghost small" onClick={actions.clearChecked}>
          Uncheck all
        </button>
      </div>

      {hasPrices && (
        <div className="cost-bar">
          <span><strong>{formatMoney(cost.remainingTotal)}</strong> to go</span>
          <span className="muted">·</span>
          <span className="muted">{formatMoney(cost.checkedTotal)} in cart</span>
          <span className="muted">·</span>
          <span className="muted">{formatMoney(cost.total)} total est.</span>
          {cost.unpricedCount > 0 && <span className="muted">· {cost.unpricedCount} not priced</span>}
        </div>
      )}

      <p className="muted" style={{ marginTop: 6, fontSize: "0.82rem" }}>
        {aisleGroups
          ? `Organized by Kroger department, ordered by aisle${lastFetched ? ` (as of ${fmtDate(lastFetched)})` : ""}. Items Kroger didn't match are in "Other" at the end.`
          : hasPrices
            ? `Per-package price estimate${lastFetched ? `, as of ${fmtDate(lastFetched)}` : ""}. Swap products or set quantities in “Review & send”.`
            : `Quantities are merged across the week and grouped by store section. Use “Get prices & aisles” to add cost + aisle order. Staples are listed separately.`}
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
                {items.map(([name, q]) => (
                  <Item key={name} name={name} qty={q} section={section} />
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
