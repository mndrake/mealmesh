import { useMemo, useState } from "react";
import type { Section, ItemLocation, Recipe } from "../lib/types";
import { useAllRecipesById } from "../lib/allRecipes";
import { cookedMeals } from "../lib/planner";
import { scaledShoppingMeals } from "../lib/scaling";
import { useHouseholdSize, MAX_HOUSEHOLD } from "../lib/household";
import { buildList, buildSources, SECTION_LABELS } from "../lib/shopping";
import { applyMerges, mergedFrom } from "../lib/listMerge";
import { normalizeForShopping } from "../lib/normalize";
import { groupByAisle, groupByAisleWalk, locationText, shelfText, isStale } from "../lib/aisleOrder";
import { costLine, summarizeCost, formatMoney } from "../lib/cost";
import { formatCookedOn, todayIso, summarize } from "../lib/history";
import { useStore, actions } from "../lib/store";
import { krogerClient, type ReviewRow } from "../lib/krogerClient";
import { exportShoppingText } from "../lib/exporter";
import { SendToMarianosModal } from "./SendToMarianosModal";
import { RecipeDetailModal } from "./RecipeDetailModal";

const STALE_DAYS = 30;
const fmtDate = (ms: number) => formatCookedOn(todayIso(new Date(ms)));

/** Map matched review rows to persistable item locations (product + aisle + shelf/bin + price). */
function locsFromRows(rows: ReviewRow[], now: number): ItemLocation[] {
  return rows
    .filter((r) => r.matched)
    .map((r) => ({
      name: r.listName,
      aisle: r.matched!.aisle,
      aisleNumber: r.matched!.aisleNumber,
      bay: r.matched!.bay,
      shelf: r.matched!.shelf,
      side: r.matched!.side,
      department: r.matched!.department,
      price: r.matched!.price,
      product: r.matched!.description,
      fetchedAt: now,
    }));
}

type ViewMode = "list" | "aisle" | "store";

export function ShoppingView({ openSend = false }: { openSend?: boolean }) {
  const plan = useStore((s) => s.activePlan);
  const recipesById = useAllRecipesById();
  const checked = useStore((s) => s.checked);
  const itemLocations = useStore((s) => s.itemLocations);
  const stapleNeeds = useStore((s) => s.stapleNeeds);
  const favorites = useStore((s) => s.favorites);
  const cookLog = useStore((s) => s.cookLog);
  const amountOverrides = useStore((s) => s.amountOverrides);
  const merges = useStore((s) => s.merges);
  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const cookSummary = useMemo(() => summarize(cookLog), [cookLog]);
  const [recipeView, setRecipeView] = useState<Recipe | null>(null); // recipe opened from an item link
  const [editAmount, setEditAmount] = useState<string | null>(null); // item whose amount is being edited
  const [amountDraft, setAmountDraft] = useState(""); // working value while editing an amount
  const [combining, setCombining] = useState<string | null>(null); // item being combined into another
  const checkedSet = useMemo(() => new Set(checked), [checked]);
  const neededSet = useMemo(() => new Set(stapleNeeds), [stapleNeeds]);
  const locMap = useMemo(() => new Map(itemLocations.map((l) => [l.name, l])), [itemLocations]);
  // Opens immediately when returning from the Kroger OAuth redirect (openSend).
  const [showKroger, setShowKroger] = useState(openSend);
  const [anchor, setAnchor] = useState<string | null>(null); // item to focus in the Review modal
  const [viewChoice, setViewChoice] = useState<ViewMode | null>(null); // null = auto
  const [refreshing, setRefreshing] = useState(false);
  const [advising, setAdvising] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [household, setHousehold] = useHouseholdSize(); // 0 = "as written" (recipe servings)
  const getQty = (name: string) => locMap.get(name)?.quantity ?? 1;

  // Build the list, "promoting" staples the user marked "need to buy" into normal items so
  // they flow into sections/aisle order/cost/cart. allStaplesSet = every staple in the plan
  // (needed or not) so the UI can show the right toggle on each.
  const { list, allStaplesSet, mealCount, sources, mergedFromMap } = useMemo(() => {
    // "As written" (household 0) keeps the parity-locked list; a set household size scales
    // every meal to that many servings (batch meals count once — scaledShoppingMeals handles it).
    const rawMeals =
      household > 0 ? scaledShoppingMeals(plan, recipesById, household) : cookedMeals(plan, recipesById);
    const base = normalizeForShopping(rawMeals);
    // Fold combined items together (built-in synonyms + manual merges) before aggregating, so
    // quantities sum under the canonical name. buildList stays untouched (parity-safe).
    const meals = applyMerges(base, merges);
    const staplesSet = new Set(buildList(meals).staples);
    const promoted = meals.map((r) => ({
      ...r,
      ingredients: r.ingredients.map((i) =>
        i.staple && neededSet.has(i.buy_as || i.item) ? { ...i, staple: false } : i
      ),
    }));
    const built = buildList(promoted);
    // Apply per-item amount overrides to the displayed quantity (display-only; flows to the
    // checklist, aisle grouping, export, and the Kroger review since they all read this list).
    const withOverrides = {
      ...built,
      sections: built.sections.map((s) => ({
        ...s,
        items: s.items.map(([name, qty]) => [name, amountOverrides[name] ?? qty] as [string, string]),
      })),
    };
    return {
      list: withOverrides,
      allStaplesSet: staplesSet,
      mealCount: base.length,
      sources: buildSources(meals),
      mergedFromMap: mergedFrom(base, merges),
    };
  }, [plan, recipesById, neededSet, merges, amountOverrides, household]);

  // Items with their expected aisle, so the matcher can prefer same-section products.
  const matchItems = () =>
    list.sections.flatMap((s) => s.items.map(([name, displayQty]) => ({ name, displayQty, section: s.section })));

  // The recipe(s)' own wording for an item (variety + prep), deduped across recipes — used to
  // link an item to its recipe and to give the AI advisor context for picking the right kind.
  const detailFor = (name: string): string | undefined => {
    const srcs = sources.get(name);
    if (!srcs?.length) return undefined;
    const seen = new Set<string>();
    for (const s of srcs) for (const d of s.detail.split("; ")) if (d) seen.add(d);
    return seen.size ? [...seen].join("; ") : undefined;
  };

  const itemCount = list.sections.reduce((n, s) => n + s.items.length, 0);
  const hasLocations = useMemo(
    () => list.sections.some((s) => s.items.some(([name]) => locMap.get(name)?.department || locMap.get(name)?.aisle)),
    [list, locMap]
  );
  const view: ViewMode = viewChoice ?? (hasLocations ? "aisle" : "list");
  const hasPrices = useMemo(
    () => list.sections.some((s) => s.items.some(([name]) => typeof locMap.get(name)?.price === "number")),
    [list, locMap]
  );

  // Cost estimate across the list, split into in-cart vs remaining.
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
    () => (view === "aisle" && hasLocations ? groupByAisle(list, locMap) : null),
    [view, hasLocations, list, locMap]
  );
  const storeGroups = useMemo(
    () => (view === "store" && hasLocations ? groupByAisleWalk(list, locMap) : null),
    [view, hasLocations, list, locMap]
  );
  const staleCount = useMemo(
    () =>
      list.sections.reduce(
        (n, s) => n + s.items.filter(([name]) => isStale(locMap.get(name), Date.now(), STALE_DAYS)).length,
        0
      ),
    [list, locMap]
  );

  /** Fetch price + aisle/shelf/product for the current list from Mariano's (server-cached) and
   *  persist it. Falls back to the guided Send flow when not connected / no store chosen yet. */
  async function updatePrices() {
    const items = matchItems();
    if (!items.length) return;
    setRefreshing(true);
    setNotice(null);
    try {
      const { rows } = await krogerClient.match(items, true);
      const locs = locsFromRows(rows, Date.now());
      if (locs.length) actions.saveItemLocations(locs);
      const matched = rows.filter((r) => r.matched).length;
      setNotice(`Updated ${matched} of ${items.length} items.`);
    } catch {
      setShowKroger(true); // not connected / no store yet — the modal handles setup
    } finally {
      setRefreshing(false);
    }
  }

  /** Ask the AI advisor to re-pick products for items whose match looks wrong (e.g. a Produce
   *  item matched to Deli), then persist the corrections. */
  async function fixMatches() {
    const items = matchItems().map((it) => ({ ...it, detail: detailFor(it.name) }));
    if (!items.length) return;
    setAdvising(true);
    setNotice(null);
    try {
      const { rows, fixed } = await krogerClient.advise(items);
      const locs = locsFromRows(rows, Date.now());
      if (locs.length) actions.saveItemLocations(locs);
      setNotice(fixed > 0 ? `Advisor fixed ${fixed} match${fixed === 1 ? "" : "es"}.` : "Advisor reviewed the list — nothing needed fixing.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setNotice(msg.includes("no_store") ? "Connect a store first (Review & send)." : "Couldn't run the advisor — try again.");
    } finally {
      setAdvising(false);
    }
  }

  function openEdit(name: string) {
    setAnchor(name);
    setShowKroger(true);
  }

  const openRecipe = (id: string) => setRecipeView(recipesById.get(id) ?? null);

  /** Set how many packages to buy for an item (the cart/price quantity), editable right on the
   *  list. Reuses the synced itemLocations.quantity; creates a minimal location if none yet. */
  function setQty(name: string, q: number) {
    const quantity = Math.max(1, Math.floor(q) || 1);
    const loc = locMap.get(name);
    const base: ItemLocation = loc ?? { name, aisle: null, aisleNumber: null, department: null, price: null, product: null, fetchedAt: 0 };
    actions.saveItemLocations([{ ...base, name, quantity }]);
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

  // All current item names (across sections), for the "combine into…" picker.
  const allNames = list.sections.flatMap((s) => s.items.map(([n]) => n));

  function Item({ name, qty: recipeQty, section }: { name: string; qty?: string; section: Section }) {
    const id = `${section}:${name}`;
    const isChecked = checkedSet.has(id);
    const isStapleItem = allStaplesSet.has(name); // a promoted "need to buy" staple
    const loc = locMap.get(name);
    const where = locationText(loc);
    const shelf = shelfText(loc);
    const stale = isStale(loc, Date.now(), STALE_DAYS);
    const price = loc?.price ?? null;
    const packages = loc?.quantity ?? 1;
    const showNoPrice = hasPrices && price == null;
    const srcs = sources.get(name) ?? [];
    const overridden = name in amountOverrides;
    const mergedKids = mergedFromMap.get(name) ?? [];
    return (
      <div className={`shop-item ${isChecked ? "checked" : ""}`}>
        <input type="checkbox" id={id} checked={isChecked} onChange={() => actions.toggleChecked(id)} />
        <div className="shop-main">
          <label htmlFor={id}>{name}</label>

          {/* Which Kroger product is mapped, + edit. */}
          {loc?.product ? (
            <div className="shop-product">
              <span className="prod" title={loc.product}>🛒 {loc.product}{packages > 1 ? ` ×${packages}` : ""}</span>
              <button className="linklike" onClick={() => openEdit(name)}>change</button>
            </div>
          ) : (
            showNoPrice && (
              <div className="shop-product">
                <span className="prod muted">no Kroger match</span>
                <button className="linklike" onClick={() => openEdit(name)}>find product</button>
              </div>
            )
          )}

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
            {shelf && <span className="shop-shelf">{shelf}</span>}
            {editAmount === name ? (
              <span className="amt-edit">
                <input
                  className="amt-input"
                  value={amountDraft}
                  autoFocus
                  aria-label={`Amount for ${name}`}
                  onChange={(e) => setAmountDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { actions.setAmountOverride(name, amountDraft); setEditAmount(null); }
                    if (e.key === "Escape") setEditAmount(null);
                  }}
                />
                <button className="linklike" onClick={() => { actions.setAmountOverride(name, amountDraft); setEditAmount(null); }}>save</button>
                {overridden && <button className="linklike" onClick={() => { actions.setAmountOverride(name, ""); setEditAmount(null); }}>reset</button>}
                <button className="linklike" onClick={() => setEditAmount(null)}>cancel</button>
              </span>
            ) : (
              <button
                className={`q qedit ${overridden ? "ovr" : ""}`}
                title={overridden ? "Edited amount — tap to change" : "Tap to correct the amount"}
                onClick={() => { setEditAmount(name); setAmountDraft(recipeQty ?? ""); }}
              >
                {recipeQty || "as needed"} ✎
              </button>
            )}
            {isStapleItem && (
              <button
                className="staple-tag on"
                title="Pantry staple you added — tap to move it back to the pantry list"
                onClick={() => actions.toggleStapleNeed(name)}
              >
                ★ staple
              </button>
            )}
            {loc?.product && (
              <span className="shop-qty" title="How many to buy (adds up in the cart & price)">
                <button className="qbtn" onClick={() => setQty(name, packages - 1)} disabled={packages <= 1} aria-label="Buy one fewer">−</button>
                <input
                  className="qnum"
                  type="number"
                  min={1}
                  value={packages}
                  aria-label={`Quantity to buy for ${name}`}
                  onChange={(e) => setQty(name, Number(e.target.value))}
                />
                <button className="qbtn" onClick={() => setQty(name, packages + 1)} aria-label="Buy one more">+</button>
              </span>
            )}
            {price != null && (
              <span className="shop-price">
                {packages > 1 ? `${packages}× ` : ""}
                {formatMoney(price * packages)}
              </span>
            )}
          </div>

          {srcs.length > 0 && (
            <div className="shop-from">
              <span>for</span>
              {srcs.map((s, i) => (
                <span key={s.recipeId}>
                  <button
                    className="linklike"
                    title={`${s.detail} — open recipe`}
                    onClick={() => openRecipe(s.recipeId)}
                  >
                    {s.recipeTitle}
                  </button>
                  {i < srcs.length - 1 ? "," : ""}
                </span>
              ))}
            </div>
          )}

          <div className="shop-actions">
            {mergedKids.length > 0 && (
              <span className="merged-hint" title={`Combined: ${[name, ...mergedKids].join(", ")}`}>
                combined: {mergedKids.join(", ")}
                <button className="linklike" onClick={() => actions.unmergeItems([name, ...mergedKids])}>separate</button>
              </span>
            )}
            {combining === name ? (
              <span className="combine-pick">
                combine into
                <select
                  className="combine-select"
                  defaultValue=""
                  aria-label={`Combine ${name} into another item`}
                  onChange={(e) => { if (e.target.value) { actions.mergeItems(name, e.target.value); setCombining(null); } }}
                >
                  <option value="" disabled>choose item…</option>
                  {allNames.filter((n) => n !== name).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <button className="linklike" onClick={() => setCombining(null)}>cancel</button>
              </span>
            ) : (
              <button className="linklike combine-btn" onClick={() => setCombining(name)}>combine</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const subtotalMap = new Map(
    list.sections.flatMap((s) => s.items.map(([name]) => [name, costLine(name, locMap.get(name)?.price ?? null, getQty(name)).subtotal] as const))
  );

  const viewBtn = (mode: ViewMode, label: string, title: string) => (
    <button
      key={mode}
      className={`btn secondary small ${view === mode ? "on" : ""}`}
      onClick={() => setViewChoice(mode)}
      disabled={mode !== "list" && !hasLocations}
      title={mode !== "list" && !hasLocations ? "Get prices & aisles first" : title}
    >
      {label}
    </button>
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
        <label
          className="household-control"
          title="Scale the whole list to feed this many people. Leave blank to use the recipes' written amounts."
        >
          <span aria-hidden>👪</span> Cooking for{" "}
          <input
            type="number"
            min={1}
            max={MAX_HOUSEHOLD}
            value={household || ""}
            placeholder="—"
            aria-label="Number of people to shop for"
            onChange={(e) => setHousehold(Number(e.target.value) || 0)}
          />
          <span className="muted">{household > 0 ? "people" : "(as written)"}</span>
        </label>
        <div className="spacer" />
        <div className="seg" role="group" aria-label="View">
          {viewBtn("list", "List", "Grouped by store section")}
          {viewBtn("aisle", "🧭 Aisle", "Grouped by Kroger department, ordered by aisle")}
          {viewBtn("store", "🏬 Store", "Aisle → shelf walking order, with product + quantity")}
        </div>
        <button
          className="btn secondary small"
          onClick={updatePrices}
          disabled={refreshing || advising}
          title="Fetch prices + aisle info for this list from Mariano's"
        >
          {refreshing ? "↻ Updating…" : hasPrices || hasLocations ? `↻ Update prices & aisles${staleCount ? ` (${staleCount} stale)` : ""}` : "💲 Get prices & aisles"}
        </button>
        {(hasPrices || hasLocations) && (
          <button
            className="btn secondary small"
            onClick={fixMatches}
            disabled={advising || refreshing}
            title="Let the AI advisor fix wrong product matches (e.g. shallots matched to Deli)"
          >
            {advising ? "✨ Fixing…" : "✨ Fix matches"}
          </button>
        )}
        <button className="btn secondary small" onClick={() => exportShoppingText(list, { subtotalOf: subtotalMap, total: cost.total })}>
          Export
        </button>
        <button className="btn secondary small" onClick={() => window.print()}>
          🖨 Print
        </button>
        <button className="btn small" onClick={() => { setAnchor(null); setShowKroger(true); }} title="Swap products, set quantities, and (optionally) send to your Mariano's cart">
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

      {notice && <p className="muted" style={{ marginTop: 6, fontSize: "0.82rem" }}>{notice}</p>}

      <p className="muted" style={{ marginTop: 6, fontSize: "0.82rem" }}>
        {view === "store"
          ? `Walking order: by aisle, then shelf/bay. Each item shows the matched product + how many to buy${lastFetched ? ` (as of ${fmtDate(lastFetched)})` : ""}. Shelf/bin show when Kroger has them. Tap “change” to swap a product.`
          : aisleGroups
            ? `Organized by store aisle${lastFetched ? ` (as of ${fmtDate(lastFetched)})` : ""}. Items Kroger didn't match are in "Other" at the end.`
            : hasPrices
              ? `Per-package price estimate${lastFetched ? `, as of ${fmtDate(lastFetched)}` : ""}. Use “Fix matches” if a product looks wrong, or “change” on any item.`
              : `Quantities are merged across the week and grouped by store section. Use “Get prices & aisles” to add cost + aisle order. Pantry staples are listed at the end — tap “Need to buy” on anything you're low on.`}
      </p>

      <div className="shop-cols">
        {(aisleGroups ?? storeGroups)
          ? (aisleGroups ?? storeGroups)!.map((g) => (
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
            <h3>
              Pantry staples — tap what you're low on
              <span className="section-hint">added ones join your list &amp; cart</span>
            </h3>
            {list.staples.map((name) => (
              <div className="shop-item staple-ref" key={name}>
                <span className="staple-name">{name}</span>
                <button
                  className="staple-tag"
                  title="Add to your shopping list & cart"
                  onClick={() => actions.toggleStapleNeed(name)}
                >
                  + Need to buy
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showKroger && (
        <SendToMarianosModal
          list={list}
          anchor={anchor}
          sources={sources}
          recipesById={recipesById}
          onClose={() => {
            setShowKroger(false);
            setAnchor(null);
          }}
        />
      )}

      {recipeView && (
        <RecipeDetailModal
          recipe={recipeView}
          isFavorite={favSet.has(recipeView.id)}
          onToggleFavorite={actions.toggleFavorite}
          history={cookSummary.get(recipeView.id)}
          onClose={() => setRecipeView(null)}
        />
      )}
    </div>
  );
}
