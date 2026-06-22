import { useMemo, useState } from "react";
import type { Recipe, PlanDay, MealRef, Category } from "../lib/types";
import { rawRecipes } from "../lib/recipes";
import { useAllRecipesById } from "../lib/allRecipes";
import { buildPlan, regeneratePlan, cookedMeals } from "../lib/planner";
import { dayTotals, weekTotals } from "../lib/nutrition";
import { planEase } from "../lib/ease";
import { prepPlan } from "../lib/prep";
import { useStore, actions } from "../lib/store";
import { summarize, historyLabel, type RecipeHistory } from "../lib/history";
import { RecipeDetailModal } from "./RecipeDetailModal";
import { RecipePickerModal } from "./RecipePickerModal";
import { MarkCookedModal } from "./MarkCookedModal";
import { SavedMenusModal } from "./SavedMenusModal";
import { exportPlanJson, exportPlanMarkdown } from "../lib/exporter";

type Slot = "breakfast" | "lunch" | "dinner" | "snack";
const SLOTS: Slot[] = ["breakfast", "lunch", "dinner", "snack"];

const CONSTRAINTS = ["diabetic-friendly", "vegetarian", "low-carb", "high-protein"];

export function PlannerView() {
  const plan = useStore((s) => s.activePlan);
  const recipesById = useAllRecipesById();
  const savedPlans = useStore((s) => s.savedPlans);
  const favorites = useStore((s) => s.favorites);
  const locked = useStore((s) => s.locked);
  const lockedSet = useMemo(() => new Set(locked), [locked]);
  const cookLog = useStore((s) => s.cookLog);
  const cookSummary = useMemo(() => summarize(cookLog), [cookLog]);
  const [require, setRequire] = useState<string[]>([]);
  const [easyBreakfast, setEasyBreakfast] = useState(true);
  const [officeLunch, setOfficeLunch] = useState(true);
  const [minimizeIng, setMinimizeIng] = useState(false);
  const [detail, setDetail] = useState<Recipe | null>(null);
  const [cooking, setCooking] = useState<Recipe | null>(null);
  const [picker, setPicker] = useState<{ di: number; slot: Slot } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMenus, setShowMenus] = useState(false);

  const planEmpty = plan.every((d) => !d.breakfast && !d.lunch && !d.dinner && !d.snack);
  const week = useMemo(() => weekTotals(plan, recipesById), [plan, recipesById]);
  const ease = useMemo(
    () => planEase(cookedMeals(plan, recipesById)),
    [plan, recipesById]
  );
  const prep = useMemo(() => prepPlan(plan, recipesById), [plan, recipesById]);

  const planOpts = {
    requireTags: require,
    excludeTags: [],
    easyWeekdayBreakfast: easyBreakfast,
    officeWeekdayLunch: officeLunch,
    minimizeIngredients: minimizeIng,
  };

  function suggest() {
    try {
      setError(null);
      // Plan generation runs on raw recipes so the app's plan matches the Python
      // reference exactly (ingredient renames in normalize.ts could shift the greedy
      // perishable-overlap tie-breaks). Chosen recipes still render via recipesById.
      const next = buildPlan(rawRecipes, planOpts);
      actions.setActivePlan(next);
      actions.clearLocks(); // a fresh week starts with nothing pinned
    } catch {
      setError(
        "Not enough recipes match those constraints to fill a week. Loosen the filters and try again."
      );
    }
  }

  function regenerate() {
    try {
      setError(null);
      // Rebuild on raw recipes (same reason as suggest), but keep locked slots and
      // drop their recipes from the pool so nothing pinned gets duplicated.
      const next = regeneratePlan(rawRecipes, plan, lockedSet, planOpts);
      actions.setActivePlan(next);
    } catch {
      setError(
        "Not enough recipes match those constraints to fill a week. Loosen the filters and try again."
      );
    }
  }

  function setSlot(di: number, slot: Slot, value: MealRef | string | null) {
    actions.setSlot(di, slot, value);
  }

  function handleDrop(di: number, slot: Slot, e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const move = e.dataTransfer.getData("application/mm-move");
    const recipeId = e.dataTransfer.getData("text/recipe-id");
    if (move) {
      const { di: si, slot: ss } = JSON.parse(move) as { di: number; slot: Slot };
      const src = plan[si][ss];
      const dst = plan[di][slot];
      setSlot(di, slot, src);
      setSlot(si, ss, dst); // swap
    } else if (recipeId) {
      setSlot(di, slot, { id: recipeId, leftover: false });
    }
  }

  return (
    <div className="container">
      <div className="row" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Weekly planner</h2>
        <div className="spacer" />
        <div className="row" style={{ gap: 6 }}>
          {CONSTRAINTS.map((c) => (
            <button
              key={c}
              className={`toggle ${require.includes(c) ? "on" : ""}`}
              onClick={() =>
                setRequire(
                  require.includes(c) ? require.filter((x) => x !== c) : [...require, c]
                )
              }
            >
              {c}
            </button>
          ))}
          <button className="btn" onClick={suggest}>
            ✨ Auto-suggest week
          </button>
          <button
            className="btn secondary"
            onClick={regenerate}
            disabled={plan.every((d) => !d.breakfast && !d.lunch && !d.dinner && !d.snack)}
            title="Rebuild non-locked slots; pinned 🔒 meals stay put"
          >
            ↻ Regenerate{lockedSet.size > 0 ? ` (keep ${lockedSet.size} 🔒)` : ""}
          </button>
        </div>
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 14, alignItems: "center" }}>
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          Mon–Fri prep:
        </span>
        <button
          className={`toggle ${easyBreakfast ? "on" : ""}`}
          onClick={() => setEasyBreakfast((v) => !v)}
          title="Limit weekday breakfasts to make-ahead or no-cook (overnight oats, muffins) — less time on work mornings"
        >
          🌙 Easy breakfasts
        </button>
        <button
          className={`toggle ${officeLunch ? "on" : ""}`}
          onClick={() => setOfficeLunch((v) => !v)}
          title="Limit weekday lunches to office-friendly, no-cook recipes — easy to pack for work, no cooking"
        >
          💼 Packable lunches
        </button>
        <button
          className={`toggle ${minimizeIng ? "on" : ""}`}
          onClick={() => setMinimizeIng((v) => !v)}
          title="Build the week from a small, reused ingredient palette — fewer distinct things to buy, cheaper and easier to maintain"
        >
          🧺 Fewer ingredients
        </button>
        <span className="muted" style={{ fontSize: "0.74rem" }}>
          (applies to auto-suggest &amp; regenerate; weekends stay unrestricted)
        </span>
      </div>

      {error && (
        <div className="filters" style={{ borderColor: "#f1c6c6", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <div className="totals-bar">
        <strong>Week totals</strong>
        <div className="stat">
          <b>{week.total.kcal}</b>
          <span>kcal</span>
        </div>
        <div className="stat">
          <b>{week.total.carb_g}g</b>
          <span>carb</span>
        </div>
        <div className="stat">
          <b>{week.netCarbs}g</b>
          <span>net carb</span>
        </div>
        <div className="stat">
          <b>{week.total.protein_g}g</b>
          <span>protein</span>
        </div>
        <div className="stat">
          <b>{week.total.fat_g}g</b>
          <span>fat</span>
        </div>
        {ease.paletteSize > 0 && (
          <div className="stat" title="Distinct ingredients to buy this week — fewer is cheaper and easier to maintain">
            <b>{ease.paletteSize}</b>
            <span>ingredients</span>
          </div>
        )}
        {week.estimated && <span className="est">includes est.</span>}
        <div className="spacer" />
        <PlanToolbar savedCount={savedPlans.length} plan={plan} onOpenMenus={() => setShowMenus(true)} />
      </div>

      {prep.prepAhead.length > 0 && (
        <div className="filters" style={{ display: "grid", gap: 6 }}>
          <strong>🧊 Weekend prep — make once, eat all week</strong>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {prep.prepAhead.map((p) => (
              <li key={p.recipeId}>
                <b>{p.title}</b> — batch-cook once, covers {p.days}{" "}
                {p.slots.join(" & ")} {p.days === 1 ? "day" : "days"}
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

      {planEmpty && (
        <div className="empty-state plan-empty">
          <span>Your week is empty. Build it with</span>
          <button className="btn small" onClick={suggest}>
            ✨ Auto-suggest a week
          </button>
          <button className="btn secondary small" onClick={() => setShowMenus(true)}>
            📚 Load a saved menu ({savedPlans.length})
          </button>
        </div>
      )}

      <div className="board-scroll">
        <div className="board">
          <div className="corner">Day</div>
          {SLOTS.map((s) => (
            <div key={s} className="colh">
              {s}
            </div>
          ))}

          {plan.map((day, di) => {
            const dt = dayTotals(day, recipesById);
            return (
              <Row
                key={day.day}
                day={day}
                di={di}
                kcal={dt.total.kcal}
                estimated={dt.estimated}
                dragOver={dragOver}
                lockedSet={lockedSet}
                cookSummary={cookSummary}
                onDragOverSlot={setDragOver}
                onDrop={handleDrop}
                onOpenDetail={setDetail}
                onMarkCooked={setCooking}
                onAdd={(slot) => setPicker({ di, slot })}
                onClear={(slot) => {
                  setSlot(di, slot, null);
                  actions.unlock(`${di}:${slot}`);
                }}
                onToggleLock={(slot) => actions.toggleLock(`${di}:${slot}`)}
              />
            );
          })}
        </div>
      </div>

      {detail && (
        <RecipeDetailModal
          recipe={detail}
          isFavorite={favorites.includes(detail.id)}
          onClose={() => setDetail(null)}
          onToggleFavorite={actions.toggleFavorite}
          history={cookSummary.get(detail.id)}
          onMarkCooked={(r) => setCooking(r)}
        />
      )}

      {cooking && <MarkCookedModal recipe={cooking} onClose={() => setCooking(null)} />}

      {showMenus && <SavedMenusModal onClose={() => setShowMenus(false)} />}

      {picker && (
        <RecipePickerModal
          category={picker.slot as Category}
          onPick={(r) => {
            setSlot(picker.di, picker.slot, { id: r.id, leftover: false });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function PlanToolbar({
  savedCount,
  plan,
  onOpenMenus,
}: {
  savedCount: number;
  plan: PlanDay[];
  onOpenMenus: () => void;
}) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <button
        className="btn secondary small"
        onClick={onOpenMenus}
        title="Save, load, rename, or delete weekly menus"
      >
        📚 Saved menus ({savedCount})
      </button>
      <button
        className="btn secondary small"
        onClick={() => exportPlanMarkdown(plan)}
        title="Download a printable plan: weekend prep, daily menu with net carbs, and shopping list"
      >
        📄 Plan doc
      </button>
      <button className="btn secondary small" onClick={() => exportPlanJson(plan)}>
        Export
      </button>
      <button className="btn secondary small" onClick={() => window.print()}>
        🖨 Print
      </button>
      <button
        className="btn ghost small"
        onClick={() => confirm("Clear the whole plan?") && actions.clearPlan()}
      >
        Clear
      </button>
    </div>
  );
}

interface RowProps {
  day: PlanDay;
  di: number;
  kcal: number;
  estimated: boolean;
  dragOver: string | null;
  lockedSet: Set<string>;
  cookSummary: Map<string, RecipeHistory>;
  onDragOverSlot: (k: string | null) => void;
  onDrop: (di: number, slot: Slot, e: React.DragEvent) => void;
  onOpenDetail: (r: Recipe) => void;
  onMarkCooked: (r: Recipe) => void;
  onAdd: (slot: Slot) => void;
  onClear: (slot: Slot) => void;
  onToggleLock: (slot: Slot) => void;
}

function Row({
  day,
  di,
  kcal,
  estimated,
  dragOver,
  lockedSet,
  cookSummary,
  onDragOverSlot,
  onDrop,
  onOpenDetail,
  onMarkCooked,
  onAdd,
  onClear,
  onToggleLock,
}: RowProps) {
  const recipesById = useAllRecipesById();
  return (
    <>
      <div className="dayh" style={{ flexDirection: "column", alignItems: "flex-start" }}>
        <span>{day.day}</span>
        <span className="day-total" style={{ padding: 0 }}>
          {kcal} kcal{estimated ? "*" : ""}
        </span>
      </div>
      {SLOTS.map((slot) => {
        const key = `${di}:${slot}`;
        const ref = day[slot];
        const isStr = typeof ref === "string";
        const isLocked = lockedSet.has(key);
        const recipe = ref && !isStr ? recipesById.get((ref as MealRef).id) : undefined;
        const made = recipe ? historyLabel(cookSummary.get(recipe.id)) : "";
        const lockBtn = (
          <button
            className={`lock-btn ${isLocked ? "on" : ""}`}
            onClick={() => onToggleLock(slot)}
            title={isLocked ? "Locked — kept on regenerate" : "Lock against regenerate"}
            aria-pressed={isLocked}
          >
            {isLocked ? "🔒" : "🔓"}
          </button>
        );
        return (
          <div
            key={slot}
            className={`slot ${!ref ? "empty" : ""} ${isLocked ? "locked" : ""} ${dragOver === key ? "dragover" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              onDragOverSlot(key);
            }}
            onDragLeave={() => onDragOverSlot(null)}
            onDrop={(e) => onDrop(di, slot, e)}
          >
            {!ref ? (
              <button className="add-btn" onClick={() => onAdd(slot)}>
                + Add
              </button>
            ) : isStr ? (
              <>
                <span className="meal-meta">snack</span>
                <span>{ref as string}</span>
                <div className="slot-actions">
                  {lockBtn}
                  <button className="btn ghost small" onClick={() => onClear(slot)}>
                    ✕
                  </button>
                </div>
              </>
            ) : (
              <div
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData(
                    "application/mm-move",
                    JSON.stringify({ di, slot })
                  )
                }
                style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}
              >
                <span
                  className="meal-title"
                  onClick={() => recipe && onOpenDetail(recipe)}
                >
                  {recipe?.title ?? "(unknown)"}
                </span>
                <span className="meal-meta">
                  {recipe ? `${recipe.nutrition_per_serving.kcal} kcal` : ""}
                  {recipe?.nutrition_estimated ? " · est." : ""}
                  {(ref as MealRef).leftover ? (
                    <span className="leftover-tag"> leftover</span>
                  ) : null}
                </span>
                {made && <span className="meal-made">🍳 {made}</span>}
                <div className="slot-actions">
                  {lockBtn}
                  {recipe && !(ref as MealRef).leftover && (
                    <button
                      className="add-btn"
                      title="Mark as made"
                      onClick={() => onMarkCooked(recipe)}
                    >
                      ✓ made
                    </button>
                  )}
                  <button className="add-btn" onClick={() => onAdd(slot)}>
                    swap
                  </button>
                  <button className="btn ghost small" onClick={() => onClear(slot)}>
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
