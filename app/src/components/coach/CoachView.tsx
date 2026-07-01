import { useState } from "react";
import { actions, useStore } from "../../lib/store";
import { todayIso } from "../../lib/history";
import { cookModeCompletionCount } from "../../lib/coach/metrics";
import {
  coachRecipeTitle,
  getBlueprint,
  getCoachRecipe,
  getMenu,
  listMenus,
} from "../../lib/coach/content";
import { coachImageUrl, menuToPlan } from "../../lib/coach/planBridge";
import type { BatchBlueprint, CoachRecipe, WeeklyMenu } from "../../lib/coach/types";
import { CookMode } from "./CookMode";
import { SundayOrchestrator } from "./SundayOrchestrator";

/** The Coach Mode home (behind VITE_COACH_MODE). Pick a weekly menu → cook each meal with the
 *  step-aware coach, or run the Sunday batch prep. The Month-1 rotation is the selectable
 *  target (PRD §6). */
export function CoachView(
  { onOpenPlan, onOpenShopping }: { onOpenPlan?: () => void; onOpenShopping?: () => void } = {}
) {
  const completed = useStore((s) => cookModeCompletionCount(s.cookLog));
  const [menuId, setMenuId] = useState<string | null>(null);
  const [cooking, setCooking] = useState<{ id: string; title: string } | null>(null);
  const [orchestrating, setOrchestrating] = useState<BatchBlueprint | null>(null);

  const menus = listMenus();
  const menu = menuId ? getMenu(menuId) : null;

  const cook = (id: string) => setCooking({ id, title: coachRecipeTitle(id) });

  return (
    <div className="container">
      <div className="coach-intro">
        <h2>🍳 Cook with Coach</h2>
        <p className="muted">
          Step-by-step guidance with USDA-cited doneness temps, technique help, and timers.{" "}
          <strong>Beta.</strong>
          {completed > 0 && (
            <> You've finished {completed} guided cook{completed === 1 ? "" : "s"}. 🎉</>
          )}
        </p>
      </div>

      {!menu ? (
        <section className="coach-section">
          <h3>Choose a week</h3>
          <div className="coach-grid">
            {menus.map((m) => (
              <button key={m.id} className="coach-launch" onClick={() => setMenuId(m.id)}>
                <strong>Month {m.month} · {m.label}</strong>
                <span className="muted">
                  {m.theme} · breakfast, lunch + {m.dinners.length} dinners
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <MenuDetail
          menu={menu}
          onBack={() => setMenuId(null)}
          onCook={cook}
          onPrep={() => {
            const bp = menu.prep_blueprint_id ? getBlueprint(menu.prep_blueprint_id) : null;
            if (bp) setOrchestrating(bp);
          }}
          onAddToPlan={() => {
            actions.setActivePlan(menuToPlan(menu));
            onOpenPlan?.();
          }}
          onBuildShopping={() => {
            actions.setActivePlan(menuToPlan(menu));
            onOpenShopping?.();
          }}
        />
      )}

      {cooking && (
        <CookMode
          recipeId={cooking.id}
          title={cooking.title}
          onClose={() => setCooking(null)}
          onFinish={(finished) => {
            // Finishing a guided cook records to the existing cook_log, tagged 'cook_mode' for
            // the North Star completion metric (PRD §5, R6).
            if (finished)
              actions.markCooked({ recipeId: cooking.id, cookedOn: todayIso(), source: "cook_mode" });
          }}
        />
      )}
      {orchestrating && (
        <SundayOrchestrator blueprint={orchestrating} onClose={() => setOrchestrating(null)} />
      )}
    </div>
  );
}

function RecipeRow({
  label,
  recipe,
  onCook,
}: {
  label: string;
  recipe: CoachRecipe | null;
  onCook: (id: string) => void;
}) {
  if (!recipe) return null;
  const img = coachImageUrl(recipe.id);
  return (
    <button className="coach-meal" onClick={() => onCook(recipe.id)}>
      {img ? (
        <img className="coach-meal-thumb" src={img} alt="" loading="lazy" />
      ) : (
        <span className="coach-meal-thumb coach-meal-thumb-empty">🍽️</span>
      )}
      <span className="coach-meal-when">{label}</span>
      <span className="coach-meal-title">{recipe.title}</span>
      <span className="coach-meal-carbs">{recipe.net_carbs_g}g net</span>
      <span className="coach-meal-go">Cook →</span>
    </button>
  );
}

/** Exported for the render smoke test (proves the selected-week view renders its recipes). */
export function MenuDetail({
  menu,
  onBack,
  onCook,
  onPrep,
  onAddToPlan,
  onBuildShopping,
}: {
  menu: WeeklyMenu;
  onBack: () => void;
  onCook: (id: string) => void;
  onPrep: () => void;
  onAddToPlan?: () => void;
  onBuildShopping?: () => void;
}) {
  const breakfast = getCoachRecipe(menu.breakfast_id);
  const lunch = getCoachRecipe(menu.lunch_id);
  const hasPrep = Boolean(menu.prep_blueprint_id && getBlueprint(menu.prep_blueprint_id));

  return (
    <section className="coach-section">
      <button className="btn ghost small" onClick={onBack}>
        ← All weeks
      </button>
      <h3>Month {menu.month} · {menu.label}</h3>
      {menu.note && <p className="muted">{menu.note}</p>}

      {/* Ordered flow so planning reads front-to-back: plan → shop → prep → cook (below). */}
      <ol className="coach-flow">
        {onAddToPlan && (
          <li>
            <button className="btn" onClick={onAddToPlan}>
              ➕ Add this week to my Plan
            </button>
            <span className="muted">Fills your 7-day board with these meals.</span>
          </li>
        )}
        {onBuildShopping && (
          <li>
            <button className="btn secondary" onClick={onBuildShopping}>
              🛒 Build the shopping list
            </button>
            <span className="muted">Aisle-grouped and scaled — then send to Mariano's.</span>
          </li>
        )}
        {hasPrep && (
          <li>
            <button className="btn secondary" onClick={onPrep}>
              📋 Run the Sunday prep plan
            </button>
            <span className="muted">A timed, parallel batch-cook to get ahead.</span>
          </li>
        )}
      </ol>
      <p className="muted" style={{ margin: "0 0 12px" }}>
        …then cook each meal below with step-by-step guidance.
      </p>

      <div className="coach-meals">
        <RecipeRow label="☀️ Breakfast" recipe={breakfast} onCook={onCook} />
        <RecipeRow label="🥗 Lunch" recipe={lunch} onCook={onCook} />
        {menu.dinners.map((d) => (
          <RecipeRow
            key={d.day}
            label={`🍽️ ${d.day}`}
            recipe={getCoachRecipe(d.recipe_id)}
            onCook={onCook}
          />
        ))}
      </div>
    </section>
  );
}
