import type { Recipe } from "../lib/types";
import { DIET_TAGS } from "../lib/filters";

interface Props {
  recipe: Recipe;
  isFavorite: boolean;
  onOpen: (r: Recipe) => void;
  onToggleFavorite: (id: string) => void;
  onAddToPlan?: (r: Recipe) => void;
}

function dietChips(r: Recipe): string[] {
  return r.tags.filter((t) => DIET_TAGS.includes(t)).slice(0, 3);
}

export function RecipeCard({
  recipe,
  isFavorite,
  onOpen,
  onToggleFavorite,
  onAddToPlan,
}: Props) {
  const n = recipe.nutrition_per_serving;
  return (
    <article
      className="card"
      draggable={!!onAddToPlan}
      onDragStart={(e) => e.dataTransfer.setData("text/recipe-id", recipe.id)}
    >
      <div className="thumb">
        {recipe.imageUrl ? (
          <img src={recipe.imageUrl} alt={recipe.title} loading="lazy" />
        ) : null}
        <span className="cat">{recipe.category}</span>
        <button
          className="fav"
          title={isFavorite ? "Remove favorite" : "Add favorite"}
          onClick={() => onToggleFavorite(recipe.id)}
        >
          {isFavorite ? "★" : "☆"}
        </button>
      </div>
      <div className="body">
        <div className="title" onClick={() => onOpen(recipe)}>
          {recipe.title}
        </div>
        <div className="macros">
          <span>
            <b>{n.kcal}</b> kcal
          </span>
          <span>
            <b>{n.carb_g}g</b> carb
          </span>
          <span>
            <b>{n.protein_g}g</b> protein
          </span>
          {recipe.nutrition_estimated && <span className="est">est.</span>}
        </div>
        <div className="tags">
          {recipe.cuisine && <span className="chip">{recipe.cuisine}</span>}
          {dietChips(recipe).map((t) => (
            <span key={t} className="chip diet">
              {t}
            </span>
          ))}
        </div>
        {onAddToPlan && (
          <button className="btn small secondary" onClick={() => onAddToPlan(recipe)}>
            + Add to plan
          </button>
        )}
      </div>
    </article>
  );
}
