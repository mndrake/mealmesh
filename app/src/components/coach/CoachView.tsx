import { useState } from "react";
import type { Recipe } from "../../lib/types";
import { useAllRecipesById } from "../../lib/allRecipes";
import { actions, useStore } from "../../lib/store";
import { todayIso } from "../../lib/history";
import { cookModeCompletionCount } from "../../lib/coach/metrics";
import { listBlueprints, getRecipeSteps } from "../../lib/coach/content";
import recipeStepData from "../../data/coach/recipe-steps.json";
import { CookMode } from "./CookMode";
import { SundayOrchestrator } from "./SundayOrchestrator";
import type { BatchBlueprint } from "../../lib/coach/types";

/** The Coach Mode home (behind VITE_COACH_MODE). Lists recipes that have guided steps and the
 *  Sunday batch blueprints, and launches Cook Mode / the Orchestrator. */
export function CoachView() {
  const byId = useAllRecipesById();
  const completed = useStore((s) => cookModeCompletionCount(s.cookLog));
  const [cooking, setCooking] = useState<Recipe | null>(null);
  const [orchestrating, setOrchestrating] = useState<BatchBlueprint | null>(null);

  const recipeIds = (recipeStepData.recipes as { recipe_id: string }[]).map((r) => r.recipe_id);
  const guided = recipeIds.map((id) => byId.get(id)).filter((r): r is Recipe => Boolean(r));
  const blueprints = listBlueprints();

  return (
    <div className="container">
      <div className="coach-intro">
        <h2>🍳 Cook with Coach</h2>
        <p className="muted">
          Step-by-step guidance with doneness temps, technique help, and timers. Doneness
          temperatures are USDA safe-minimum values, cited on each step.{" "}
          <strong>Beta</strong> — guided content currently covers {guided.length} recipe
          {guided.length === 1 ? "" : "s"}.
          {completed > 0 && (
            <> You've finished {completed} guided cook{completed === 1 ? "" : "s"}. 🎉</>
          )}
        </p>
      </div>

      {blueprints.length > 0 && (
        <section className="coach-section">
          <h3>Sunday Batch Orchestrator</h3>
          <div className="coach-grid">
            {blueprints.map((bp) => (
              <button key={bp.id} className="coach-launch" onClick={() => setOrchestrating(bp)}>
                <strong>{bp.title}</strong>
                <span className="muted">
                  ~{bp.total_minutes} min · {bp.tasks.length} steps
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="coach-section">
        <h3>Guided recipes</h3>
        {guided.length === 0 ? (
          <p className="muted">No guided recipes available.</p>
        ) : (
          <div className="coach-grid">
            {guided.map((r) => (
              <button key={r.id} className="coach-launch" onClick={() => setCooking(r)}>
                <strong>{r.title}</strong>
                <span className="muted">
                  {getRecipeSteps(r.id)?.steps.length ?? 0} steps · {r.category}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {cooking && (
        <CookMode
          recipe={cooking}
          onClose={() => setCooking(null)}
          onFinish={(finished) => {
            // A finished guided cook is recorded in the existing cook_log, tagged source
            // 'cook_mode' so it feeds the North Star completion metric (PRD §5, R6).
            if (finished)
              actions.markCooked({
                recipeId: cooking.id,
                cookedOn: todayIso(),
                source: "cook_mode",
              });
          }}
        />
      )}
      {orchestrating && (
        <SundayOrchestrator blueprint={orchestrating} onClose={() => setOrchestrating(null)} />
      )}
    </div>
  );
}
