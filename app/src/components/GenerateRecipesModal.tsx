// Generate novel, ultra-simple, diabetic recipes from constraints, then review and save the
// ones you like into the household's recipes. The server (recipe-generate function) asks
// Claude; this is the form + review list. Saved recipes flow into user_recipes and appear in
// Browse, the planner, and (for the monthly plan) the rotation pool — making plans simpler.
import { useEffect, useState } from "react";
import type { Recipe, Category } from "../lib/types";
import { actions } from "../lib/store";
import { netCarbs } from "../lib/nutrition";
import { generateRecipes, type GeneratedRecipeResult } from "../lib/recipeClient";

const CATEGORIES: Category[] = ["breakfast", "lunch", "dinner", "snack"];

export function GenerateRecipesModal({ onClose }: { onClose: () => void }) {
  const [role, setRole] = useState<Category>("breakfast");
  const [count, setCount] = useState(4);
  const [maxIngredients, setMaxIngredients] = useState(5);
  const [maxNetCarbs, setMaxNetCarbs] = useState(12);
  const [palette, setPalette] = useState("");
  const [noFish, setNoFish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeneratedRecipeResult[] | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Generate in small batches (each its own fast server call) so a single request never
  // exceeds the function timeout, and show recipes as they arrive. Partial results are kept
  // if a later batch fails.
  const BATCH = 3;

  async function run() {
    setBusy(true);
    setError(null);
    setResults([]);
    setSaved(new Set());
    const base = {
      role,
      maxIngredients,
      maxNetCarbs,
      servings: 2,
      palette: palette.split(",").map((s) => s.trim()).filter(Boolean),
      noFish,
    };
    const acc: GeneratedRecipeResult[] = [];
    try {
      for (let remaining = count; remaining > 0; remaining -= BATCH) {
        const batch = await generateRecipes({ ...base, count: Math.min(BATCH, remaining) });
        acc.push(...batch);
        setResults([...acc]);
      }
    } catch (e) {
      setError(friendlyError((e as Error).message));
      if (acc.length) setResults([...acc]); // keep what we got
    } finally {
      setBusy(false);
    }
  }

  function saveOne(recipe: Recipe) {
    actions.addUserRecipe(recipe);
    setSaved((s) => new Set(s).add(recipe.id));
  }

  function saveAllClean() {
    if (!results) return;
    for (const { recipe, issues } of results) {
      if (!issues.length && !saved.has(recipe.id)) actions.addUserRecipe(recipe);
    }
    setSaved(new Set(results.map((r) => r.recipe.id)));
  }

  const cleanCount = results?.filter((r) => !r.issues.length).length ?? 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="content">
          <h2 style={{ marginTop: 0 }}>Generate recipes</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Create novel, ultra-simple, diabetic recipes — few ingredients, net-carb friendly —
            then save the ones you like. They join your recipes and make generated plans simpler.
          </p>

          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="cook-field" style={{ flex: "1 1 110px" }}>
              <span>Meal</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Category)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="cook-field" style={{ flex: "0 1 90px" }}>
              <span>How many</span>
              <input type="number" min={1} max={8} value={count} onChange={(e) => setCount(clamp(e.target.value, 1, 8))} />
            </label>
            <label className="cook-field" style={{ flex: "0 1 110px" }}>
              <span>Max ingredients</span>
              <input type="number" min={1} max={15} value={maxIngredients} onChange={(e) => setMaxIngredients(clamp(e.target.value, 1, 15))} />
            </label>
            <label className="cook-field" style={{ flex: "0 1 110px" }}>
              <span>Max net carbs</span>
              <input type="number" min={0} max={200} value={maxNetCarbs} onChange={(e) => setMaxNetCarbs(clamp(e.target.value, 0, 200))} />
            </label>
          </div>

          <label className="cook-field" style={{ marginTop: 8 }}>
            <span>Reuse these ingredients (optional, comma-separated)</span>
            <input
              placeholder="chicken breast, romaine, cucumber, feta, olive oil"
              value={palette}
              onChange={(e) => setPalette(e.target.value)}
            />
          </label>

          <label className="row" style={{ gap: 6, marginTop: 8, alignItems: "center" }}>
            <input type="checkbox" checked={noFish} onChange={(e) => setNoFish(e.target.checked)} />
            <span className="muted" style={{ fontSize: "0.85rem" }}>No fish (seafood like shrimp is fine)</span>
          </label>

          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={run} disabled={busy}>
              {busy ? "Generating…" : results ? "Regenerate" : "Generate"}
            </button>
            {results && cleanCount > 0 && (
              <button className="btn secondary" onClick={saveAllClean}>
                Save all {cleanCount} that pass
              </button>
            )}
          </div>
          {error && <p className="import-error">{error}</p>}

          {results && (
            <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
              {results.length === 0 && <p className="muted">No recipes came back. Try again.</p>}
              {results.map(({ recipe, issues }) => {
                const shoppable = recipe.ingredients.filter((i) => !i.staple);
                const net = netCarbs(recipe.nutrition_per_serving);
                const isSaved = saved.has(recipe.id);
                return (
                  <div key={recipe.id} className="card" style={{ padding: "10px 12px", display: "grid", gap: 4 }}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <strong>{recipe.title}</strong>
                      <button
                        className={`btn small ${isSaved ? "ghost" : ""}`}
                        onClick={() => saveOne(recipe)}
                        disabled={isSaved}
                      >
                        {isSaved ? "Saved ✓" : "Save"}
                      </button>
                    </div>
                    <div className="muted" style={{ fontSize: "0.8rem" }}>
                      {shoppable.length} ingredients · ~{net}g net carbs · {recipe.prep_style.replace("_", " ")}
                      {recipe.office_friendly ? " · packable" : ""}
                      {recipe.batch ? " · batch" : ""}
                    </div>
                    <div className="muted" style={{ fontSize: "0.82rem" }}>
                      {shoppable.map((i) => i.item).join(", ")}
                    </div>
                    {issues.length > 0 && (
                      <div className="import-error" style={{ fontSize: "0.78rem", margin: 0 }}>
                        ⚠ {issues.join("; ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function clamp(v: string, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number(v) || lo));
}

function friendlyError(msg: string): string {
  if (msg.includes("ai_unconfigured")) return "Recipe generation isn't configured on the server.";
  if (msg.includes("rate_limited")) return msg.replace(/^rate_limited:?\s*/, "") || "Too many AI recipe requests recently — try again later.";
  if (msg.includes("ai_failed") || msg.includes("ai_parse")) return "Generation failed. Try again.";
  if (msg.includes("unauthorized")) return "Please sign in to generate recipes.";
  return msg;
}
