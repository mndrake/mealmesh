import { useMemo, useState } from "react";
import type { Recipe, Category } from "../lib/types";
import { recipes } from "../lib/recipes";
import { applyFilters, emptyFilters } from "../lib/filters";

interface Props {
  /** Pre-filter to this category (the slot being filled); null = any. */
  category: Category | null;
  onPick: (r: Recipe) => void;
  onClose: () => void;
}

export function RecipePickerModal({ category, onPick, onClose }: Props) {
  const [search, setSearch] = useState("");
  const results = useMemo(() => {
    const f = {
      ...emptyFilters(),
      search,
      categories: category ? [category] : [],
    };
    return applyFilters(recipes, f, new Set()).slice(0, 60);
  }, [search, category]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>
          ×
        </button>
        <div className="content">
          <h2 style={{ marginTop: 0 }}>
            Pick a recipe{category ? ` — ${category}` : ""}
          </h2>
          <input
            className="search"
            autoFocus
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={{ maxHeight: 420, overflowY: "auto", marginTop: 12 }}>
            {results.map((r) => (
              <button
                key={r.id}
                className="row"
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  marginBottom: 6,
                }}
                onClick={() => onPick(r)}
              >
                {r.imageUrl && (
                  <img
                    src={r.imageUrl}
                    alt=""
                    width={44}
                    height={32}
                    style={{ borderRadius: 5, objectFit: "cover" }}
                  />
                )}
                <span style={{ flex: 1, fontWeight: 600 }}>{r.title}</span>
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  {r.nutrition_per_serving.kcal} kcal · {r.nutrition_per_serving.carb_g}g carb
                  {r.nutrition_estimated ? " · est." : ""}
                </span>
              </button>
            ))}
            {results.length === 0 && <div className="empty-state">No matches.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
