import { useEffect } from "react";
import type { Recipe, Ingredient, Section } from "../lib/types";
import { SECTION_ORDER, SECTION_LABELS } from "../lib/shopping";
import { historyLabel, type RecipeHistory } from "../lib/history";

function fmtQty(i: Ingredient): string {
  const parts: string[] = [];
  if (i.qty != null) parts.push(String(i.qty));
  if (i.unit && i.unit !== "each" && i.unit !== "to taste") parts.push(i.unit);
  else if (i.unit === "to taste") return "to taste";
  return parts.join(" ");
}

// Tooltip explaining what the original recipe data said before normalization.
function normalizedTitle(
  from: NonNullable<Ingredient["normalizedFrom"]>,
  section: Section
): string {
  const parts: string[] = [];
  if (from.item) parts.push(`name: “${from.item}”`);
  if (from.section) parts.push(`aisle: ${from.section} → ${section}`);
  return `Normalized from original data (${parts.join("; ")})`;
}

function groupBySection(ings: Ingredient[]): [Section, Ingredient[]][] {
  const map = new Map<Section, Ingredient[]>();
  for (const i of ings) {
    if (!map.has(i.section)) map.set(i.section, []);
    map.get(i.section)!.push(i);
  }
  return SECTION_ORDER.filter((s) => map.has(s)).map((s) => [s, map.get(s)!]);
}

interface Props {
  recipe: Recipe;
  isFavorite: boolean;
  onClose: () => void;
  onToggleFavorite: (id: string) => void;
  onAddToPlan?: (r: Recipe) => void;
  history?: RecipeHistory;
  onMarkCooked?: (r: Recipe) => void;
}

export function RecipeDetailModal({
  recipe,
  isFavorite,
  onClose,
  onToggleFavorite,
  onAddToPlan,
  history,
  onMarkCooked,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const n = recipe.nutrition_per_serving;
  const img = recipe.image_source;
  const totalTime = (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="hero">
          {recipe.imageUrl ? <img src={recipe.imageUrl} alt={recipe.title} /> : null}
        </div>
        <div className="content">
          <div className="row">
            <h2 style={{ flex: 1 }}>{recipe.title}</h2>
            <button className="btn ghost" onClick={() => onToggleFavorite(recipe.id)}>
              {isFavorite ? "★ Favorited" : "☆ Favorite"}
            </button>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className="chip">{recipe.category}</span>
            {recipe.cuisine && <span className="chip">{recipe.cuisine}</span>}
            {totalTime > 0 && <span className="chip">{totalTime} min</span>}
            <span className="chip">{recipe.prep_style.replace("_", " ")}</span>
            <span className="chip">serves {recipe.servings}</span>
          </div>

          {(historyLabel(history) || onMarkCooked) && (
            <div className="row" style={{ gap: 10, marginTop: 10, alignItems: "center" }}>
              {historyLabel(history) && <span className="made-line">🍳 {historyLabel(history)}</span>}
              {onMarkCooked && (
                <button className="btn small secondary" onClick={() => onMarkCooked(recipe)}>
                  ✓ Mark as made
                </button>
              )}
            </div>
          )}

          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <strong>Nutrition per serving</strong>
            {recipe.nutrition_estimated ? (
              <span className="est">est.</span>
            ) : (
              <span className="chip">published</span>
            )}
          </div>
          <div className="nutrition-grid">
            {[
              ["kcal", n.kcal],
              ["carb", `${n.carb_g}g`],
              ["fiber", `${n.fiber_g}g`],
              ["protein", `${n.protein_g}g`],
              ["fat", `${n.fat_g}g`],
            ].map(([label, val]) => (
              <div className="cell" key={label}>
                <div className="n">{val}</div>
                <div className="l">{label}</div>
              </div>
            ))}
          </div>

          <div className="section-h">Ingredients</div>
          {groupBySection(recipe.ingredients).map(([section, items]) => (
            <div key={section}>
              <div style={{ fontWeight: 600, fontSize: "0.82rem", marginTop: 8 }}>
                {SECTION_LABELS[section].label}
                {SECTION_LABELS[section].hint && (
                  <span className="section-hint">{SECTION_LABELS[section].hint}</span>
                )}
              </div>
              <ul className="ingredient-list">
                {items.map((i, idx) => (
                  <li key={idx}>
                    <span className="qty">{fmtQty(i)}</span>
                    <span>
                      {i.buy_as && i.buy_as !== i.item ? i.buy_as : i.item}
                      {i.note ? `, ${i.note}` : ""}
                      {i.optional ? " (optional)" : ""}
                      {i.normalizedFrom && (
                        <span
                          className="norm-mark"
                          title={normalizedTitle(i.normalizedFrom, section)}
                        >
                          ✎
                        </span>
                      )}
                      {i.staple ? " " : ""}
                      {i.staple && <span className="chip">staple</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="section-h">Method</div>
          {recipe.method_is_link_only && recipe.source?.url ? (
            <p>
              This recipe links out for the full steps.{" "}
              <a href={recipe.source.url} target="_blank" rel="noreferrer">
                View method at {recipe.source.name || "source"} ↗
              </a>
            </p>
          ) : recipe.method ? (
            <div className="method">{recipe.method}</div>
          ) : recipe.source?.url ? (
            <p>
              <a href={recipe.source.url} target="_blank" rel="noreferrer">
                View source ↗
              </a>
            </p>
          ) : (
            <p className="muted">No method recorded.</p>
          )}

          {recipe.notes && (
            <>
              <div className="section-h">Notes</div>
              <div className="method">{recipe.notes}</div>
            </>
          )}

          {onAddToPlan && (
            <div style={{ marginTop: 16 }}>
              <button className="btn" onClick={() => onAddToPlan(recipe)}>
                + Add to plan
              </button>
            </div>
          )}

          <div className="attribution">
            {recipe.source?.url && (
              <div>
                Recipe source:{" "}
                <a href={recipe.source.url} target="_blank" rel="noreferrer">
                  {recipe.source.name || recipe.source.url}
                </a>
                {recipe.source.note ? ` — ${recipe.source.note}` : ""}
              </div>
            )}
            {img && (img.page || img.file) && (
              <div>
                Image:{" "}
                {img.page ? (
                  <a href={img.page} target="_blank" rel="noreferrer">
                    {img.file || "source"}
                  </a>
                ) : (
                  img.file
                )}
                {img.repository ? ` (${img.repository})` : ""}
                {img.note ? ` — ${img.note}` : ""}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
