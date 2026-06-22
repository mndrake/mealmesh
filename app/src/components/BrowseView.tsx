import { useMemo, useState } from "react";
import type { Recipe } from "../lib/types";
import { useAllRecipes } from "../lib/allRecipes";
import {
  applyFilters,
  cuisineIndex,
  emptyFilters,
  type Filters,
} from "../lib/filters";
import { useStore, actions } from "../lib/store";
import { summarize } from "../lib/history";
import { FilterPanel } from "./FilterPanel";
import { RecipeCard } from "./RecipeCard";
import { RecipeDetailModal } from "./RecipeDetailModal";
import { MarkCookedModal } from "./MarkCookedModal";
import { ImportRecipeModal } from "./ImportRecipeModal";
import { GenerateRecipesModal } from "./GenerateRecipesModal";

interface Props {
  onAddToPlan: (r: Recipe) => void;
}

export function BrowseView({ onAddToPlan }: Props) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [cooking, setCooking] = useState<Recipe | null>(null);
  const [importing, setImporting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const recipes = useAllRecipes();
  const favorites = useStore((s) => s.favorites);
  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const cookLog = useStore((s) => s.cookLog);
  const cookSummary = useMemo(() => summarize(cookLog), [cookLog]);
  const cuisines = useMemo(() => cuisineIndex(recipes), [recipes]);

  const results = useMemo(
    () => applyFilters(recipes, filters, favSet),
    [recipes, filters, favSet]
  );

  return (
    <div className="container">
      <FilterPanel
        filters={filters}
        cuisines={cuisines}
        onChange={setFilters}
        onReset={() => setFilters(emptyFilters())}
      />

      <div className="section-title">
        <h2 style={{ margin: 0 }}>Recipes</h2>
        <span className="count-pill">
          {results.length} of {recipes.length}
        </span>
        <div className="spacer" />
        <button className="btn small" onClick={() => setGenerating(true)}>
          ✨ Generate
        </button>
        <button className="btn small" onClick={() => setImporting(true)}>
          + Import recipe
        </button>
      </div>

      {results.length === 0 ? (
        <div className="empty-state">No recipes match these filters.</div>
      ) : (
        <div className="grid-cards">
          {results.map((r) => (
            <RecipeCard
              key={r.id}
              recipe={r}
              isFavorite={favSet.has(r.id)}
              onOpen={setSelected}
              onToggleFavorite={actions.toggleFavorite}
              onAddToPlan={onAddToPlan}
              history={cookSummary.get(r.id)}
            />
          ))}
        </div>
      )}

      {selected && (
        <RecipeDetailModal
          recipe={selected}
          isFavorite={favSet.has(selected.id)}
          onClose={() => setSelected(null)}
          onToggleFavorite={actions.toggleFavorite}
          onAddToPlan={(r) => {
            onAddToPlan(r);
            setSelected(null);
          }}
          history={cookSummary.get(selected.id)}
          onMarkCooked={(r) => setCooking(r)}
        />
      )}

      {cooking && <MarkCookedModal recipe={cooking} onClose={() => setCooking(null)} />}

      {importing && (
        <ImportRecipeModal
          onClose={() => setImporting(false)}
          onSaved={(r) => {
            setImporting(false);
            setSelected(r);
          }}
        />
      )}

      {generating && <GenerateRecipesModal onClose={() => setGenerating(false)} />}
    </div>
  );
}
