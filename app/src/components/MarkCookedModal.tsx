// "Mark as made" (M3): record a cook event with optional quick feedback — date,
// thumbs (make again), 1–5 rating, and a note. Writes via actions.markCooked.
import { useEffect, useState } from "react";
import type { Recipe, CookEvent } from "../lib/types";
import { actions } from "../lib/store";
import { todayIso } from "../lib/history";

/** Record a new "made" event, or edit an existing one when `event` is passed. */
export function MarkCookedModal({ recipe, event, onClose }: { recipe: Recipe; event?: CookEvent; onClose: () => void }) {
  const [cookedOn, setCookedOn] = useState(() => event?.cookedOn ?? todayIso());
  const [makeAgain, setMakeAgain] = useState<boolean | null>(event?.makeAgain ?? null);
  const [rating, setRating] = useState<number | null>(event?.rating ?? null);
  const [notes, setNotes] = useState(event?.notes ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    if (event) actions.editCookEvent(event.id, { cookedOn, rating, makeAgain, notes });
    else actions.markCooked({ recipeId: recipe.id, cookedOn, rating, makeAgain, notes });
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="content">
          <h2 style={{ marginTop: 0 }}>{event ? "Edit cooking record" : "✓ Mark as made"}</h2>
          <p className="muted" style={{ marginTop: 0 }}>{recipe.title}</p>

          <label className="cook-field">
            <span>Date</span>
            <input type="date" value={cookedOn} max={todayIso()} onChange={(e) => setCookedOn(e.target.value)} />
          </label>

          <div className="cook-field">
            <span>Make again?</span>
            <div className="row" style={{ gap: 6 }}>
              <button
                className={`toggle ${makeAgain === true ? "on" : ""}`}
                onClick={() => setMakeAgain((v) => (v === true ? null : true))}
              >
                👍 Yes
              </button>
              <button
                className={`toggle ${makeAgain === false ? "on" : ""}`}
                onClick={() => setMakeAgain((v) => (v === false ? null : false))}
              >
                👎 No
              </button>
            </div>
          </div>

          <div className="cook-field">
            <span>Rating</span>
            <div className="star-row" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className="star"
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  aria-pressed={rating != null && n <= rating}
                  onClick={() => setRating((v) => (v === n ? null : n))}
                >
                  {rating != null && n <= rating ? "★" : "☆"}
                </button>
              ))}
              {rating != null && (
                <button className="btn ghost small" onClick={() => setRating(null)}>
                  clear
                </button>
              )}
            </div>
          </div>

          <label className="cook-field">
            <span>Note (optional)</span>
            <textarea
              rows={2}
              value={notes}
              placeholder="Tweaks, what worked, who liked it…"
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={save}>
              Save
            </button>
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
