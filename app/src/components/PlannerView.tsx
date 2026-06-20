import { useMemo, useState } from "react";
import type { Recipe, PlanDay, MealRef, Category } from "../lib/types";
import { rawRecipes, recipesById } from "../lib/recipes";
import { buildPlan } from "../lib/planner";
import { dayTotals, weekTotals } from "../lib/nutrition";
import { useStore, actions } from "../lib/store";
import { RecipeDetailModal } from "./RecipeDetailModal";
import { RecipePickerModal } from "./RecipePickerModal";
import { exportPlanJson } from "../lib/exporter";

type Slot = "breakfast" | "lunch" | "dinner" | "snack";
const SLOTS: Slot[] = ["breakfast", "lunch", "dinner", "snack"];

const CONSTRAINTS = ["diabetic-friendly", "vegetarian", "low-carb", "high-protein"];

export function PlannerView() {
  const plan = useStore((s) => s.activePlan);
  const savedPlans = useStore((s) => s.savedPlans);
  const favorites = useStore((s) => s.favorites);
  const [require, setRequire] = useState<string[]>([]);
  const [detail, setDetail] = useState<Recipe | null>(null);
  const [picker, setPicker] = useState<{ di: number; slot: Slot } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const week = useMemo(() => weekTotals(plan, recipesById), [plan]);

  function suggest() {
    try {
      setError(null);
      // Plan generation runs on raw recipes so the app's plan matches the Python
      // reference exactly (ingredient renames in normalize.ts could shift the greedy
      // perishable-overlap tie-breaks). Chosen recipes still render via recipesById.
      const next = buildPlan(rawRecipes, { requireTags: require, excludeTags: [] });
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
        </div>
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
          <b>{week.total.protein_g}g</b>
          <span>protein</span>
        </div>
        <div className="stat">
          <b>{week.total.fat_g}g</b>
          <span>fat</span>
        </div>
        {week.estimated && <span className="est">includes est.</span>}
        <div className="spacer" />
        <PlanToolbar savedCount={savedPlans.length} plan={plan} />
      </div>

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
                onDragOverSlot={setDragOver}
                onDrop={handleDrop}
                onOpenDetail={setDetail}
                onAdd={(slot) => setPicker({ di, slot })}
                onClear={(slot) => setSlot(di, slot, null)}
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
        />
      )}

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

function PlanToolbar({ savedCount, plan }: { savedCount: number; plan: PlanDay[] }) {
  const saved = useStore((s) => s.savedPlans);
  return (
    <div className="row" style={{ gap: 6 }}>
      <select
        className="btn secondary small"
        value=""
        onChange={(e) => e.target.value && actions.loadPlan(e.target.value)}
        title="Load a saved plan"
      >
        <option value="">Load… ({savedCount})</option>
        {saved.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        className="btn secondary small"
        onClick={() => {
          const name = prompt("Save plan as:");
          if (name) actions.savePlanAs(name.trim());
        }}
      >
        Save as…
      </button>
      <button className="btn secondary small" onClick={() => exportPlanJson(plan)}>
        Export
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
  onDragOverSlot: (k: string | null) => void;
  onDrop: (di: number, slot: Slot, e: React.DragEvent) => void;
  onOpenDetail: (r: Recipe) => void;
  onAdd: (slot: Slot) => void;
  onClear: (slot: Slot) => void;
}

function Row({
  day,
  di,
  kcal,
  estimated,
  dragOver,
  onDragOverSlot,
  onDrop,
  onOpenDetail,
  onAdd,
  onClear,
}: RowProps) {
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
        const recipe = ref && !isStr ? recipesById.get((ref as MealRef).id) : undefined;
        return (
          <div
            key={slot}
            className={`slot ${!ref ? "empty" : ""} ${dragOver === key ? "dragover" : ""}`}
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
                <div className="slot-actions">
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
