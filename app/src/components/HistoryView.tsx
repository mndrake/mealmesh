// History view (M3): the household's cook-log, newest first — what was made, when, and
// the quick feedback. Click a row to open the recipe; delete removes the event.
import { useMemo, useState } from "react";
import type { Recipe, CookEvent } from "../lib/types";
import { useStore, actions } from "../lib/store";
import { useAllRecipesById } from "../lib/allRecipes";
import { recentCooks, formatCookedOn } from "../lib/history";
import { RecipeDetailModal } from "./RecipeDetailModal";
import { MarkCookedModal } from "./MarkCookedModal";

function feedback(rating: number | null, makeAgain: boolean | null): string {
  const parts: string[] = [];
  if (rating != null) parts.push("★".repeat(rating) + "☆".repeat(5 - rating));
  if (makeAgain === true) parts.push("👍");
  else if (makeAgain === false) parts.push("👎");
  return parts.join("  ");
}

export function HistoryView() {
  const cookLog = useStore((s) => s.cookLog);
  const favorites = useStore((s) => s.favorites);
  const recipesById = useAllRecipesById();
  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const recent = useMemo(() => recentCooks(cookLog), [cookLog]);
  const [detail, setDetail] = useState<Recipe | null>(null);
  const [editing, setEditing] = useState<{ recipe: Recipe; event: CookEvent } | null>(null);

  if (cookLog.length === 0) {
    return (
      <div className="container">
        <div className="empty-state">
          No cooking history yet. Mark a planned meal as <strong>✓ made</strong> in the{" "}
          <strong>Plan</strong> tab to start tracking what you cook.
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="row" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Cooking history</h2>
        <span className="count-pill">{cookLog.length} cooked</span>
      </div>

      <div className="history-list">
        {recent.map((e) => {
          const recipe = recipesById.get(e.recipeId);
          const fb = feedback(e.rating, e.makeAgain);
          return (
            <div className="history-row" key={e.id}>
              <div className="history-date">{formatCookedOn(e.cookedOn)}</div>
              <div className="history-main">
                <span
                  className="history-title"
                  onClick={() => recipe && setDetail(recipe)}
                  title={recipe ? "Open recipe" : undefined}
                >
                  {recipe?.title ?? e.recipeId}
                </span>
                {fb && <span className="history-fb">{fb}</span>}
                {e.notes && <span className="history-note">{e.notes}</span>}
              </div>
              {recipe && (
                <button className="btn secondary small" onClick={() => setEditing({ recipe, event: e })}>
                  Edit
                </button>
              )}
              <button
                className="btn ghost small"
                onClick={() => confirm("Remove this cooking record?") && actions.deleteCookEvent(e.id)}
                aria-label="Delete record"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {detail && (
        <RecipeDetailModal
          recipe={detail}
          isFavorite={favSet.has(detail.id)}
          onClose={() => setDetail(null)}
          onToggleFavorite={actions.toggleFavorite}
        />
      )}

      {editing && (
        <MarkCookedModal recipe={editing.recipe} event={editing.event} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
