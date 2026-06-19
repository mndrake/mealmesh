import type { Recipe, PlanDay } from "../lib/types";

type Slot = "breakfast" | "lunch" | "dinner" | "snack";
const SLOTS: Slot[] = ["breakfast", "lunch", "dinner", "snack"];

interface Props {
  recipe: Recipe;
  plan: PlanDay[];
  onPick: (dayIndex: number, slot: Slot) => void;
  onClose: () => void;
}

/** Pick which day+slot a chosen recipe should drop into. The recipe's own
 *  category slot is highlighted as the natural target. */
export function AddToPlanModal({ recipe, plan, onPick, onClose }: Props) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>
          ×
        </button>
        <div className="content">
          <h2 style={{ marginTop: 0 }}>Add to plan</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            “{recipe.title}” — choose a day and meal slot.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "auto repeat(4, 1fr)", gap: 6 }}>
            <div />
            {SLOTS.map((s) => (
              <div key={s} className="colh" style={{ textAlign: "center" }}>
                {s}
              </div>
            ))}
            {plan.map((d, di) => (
              <Row key={d.day} day={d.day} di={di} recipe={recipe} onPick={onPick} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  day,
  di,
  recipe,
  onPick,
}: {
  day: string;
  di: number;
  recipe: Recipe;
  onPick: (dayIndex: number, slot: Slot) => void;
}) {
  return (
    <>
      <div className="dayh">{day}</div>
      {SLOTS.map((s) => {
        const natural = recipe.category === s;
        return (
          <button
            key={s}
            className={`btn small ${natural ? "" : "secondary"}`}
            style={{ opacity: natural ? 1 : 0.85 }}
            onClick={() => onPick(di, s)}
            title={natural ? "Matches this recipe's category" : ""}
          >
            +
          </button>
        );
      })}
    </>
  );
}
