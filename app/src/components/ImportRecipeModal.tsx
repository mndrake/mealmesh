// Import a recipe from a URL, then review/edit the extracted draft before saving it to the
// household's imported recipes. The server (recipe-import function) does the fetch +
// extraction (schema.org JSON-LD, with a Claude fallback); this is the review form.
import { useEffect, useState } from "react";
import type { Recipe, Ingredient, Category, Section } from "../lib/types";
import { SECTION_ORDER, SECTION_LABELS } from "../lib/shopping";
import { actions } from "../lib/store";
import { importRecipe } from "../lib/recipeClient";

const CATEGORIES: Category[] = ["breakfast", "lunch", "dinner", "snack"];

export function ImportRecipeModal({ onClose, onSaved }: { onClose: () => void; onSaved: (r: Recipe) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Recipe | null>(null);
  const [via, setVia] = useState<"jsonld" | "ai" | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function doImport() {
    const u = url.trim();
    if (!u) return;
    setBusy(true);
    setError(null);
    try {
      const res = await importRecipe(u);
      setDraft(res.recipe);
      setVia(res.via);
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  function patch(p: Partial<Recipe>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  function patchIng(idx: number, p: Partial<Ingredient>) {
    setDraft((d) =>
      d ? { ...d, ingredients: d.ingredients.map((ing, i) => (i === idx ? { ...ing, ...p } : ing)) } : d
    );
  }

  function removeIng(idx: number) {
    setDraft((d) => (d ? { ...d, ingredients: d.ingredients.filter((_, i) => i !== idx) } : d));
  }

  function addIng() {
    setDraft((d) =>
      d
        ? {
            ...d,
            ingredients: [
              ...d.ingredients,
              { qty: null, unit: "each", item: "", section: "Pantry & Dry Goods", perishable: false, staple: false },
            ],
          }
        : d
    );
  }

  function save() {
    if (!draft) return;
    const clean: Recipe = {
      ...draft,
      title: draft.title.trim() || "Imported recipe",
      ingredients: draft.ingredients.filter((i) => i.item.trim()),
    };
    actions.addUserRecipe(clean);
    onSaved(clean);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="content">
          <h2 style={{ marginTop: 0 }}>Import a recipe</h2>

          {!draft && (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Paste a recipe page URL. We read the page's recipe data (and fall back to AI for
                pages without it), then let you review it before saving.
              </p>
              <div className="row" style={{ gap: 6 }}>
                <input
                  className="search"
                  style={{ flex: 1 }}
                  type="url"
                  placeholder="https://example.com/recipes/…"
                  value={url}
                  autoFocus
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doImport()}
                />
                <button className="btn" onClick={doImport} disabled={busy || !url.trim()}>
                  {busy ? "Importing…" : "Import"}
                </button>
              </div>
              {error && <p className="import-error">{error}</p>}
            </>
          )}

          {draft && (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                {via === "ai" ? "Extracted with AI" : "Extracted from the page"} — review and edit, then save.
              </p>

              <label className="cook-field">
                <span>Title</span>
                <input value={draft.title} onChange={(e) => patch({ title: e.target.value })} />
              </label>

              <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                <label className="cook-field" style={{ flex: "1 1 120px" }}>
                  <span>Meal</span>
                  <select value={draft.category} onChange={(e) => patch({ category: e.target.value as Category })}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cook-field" style={{ flex: "1 1 120px" }}>
                  <span>Cuisine</span>
                  <input
                    value={draft.cuisine ?? ""}
                    onChange={(e) => patch({ cuisine: e.target.value.trim() || null })}
                  />
                </label>
                <label className="cook-field" style={{ flex: "0 1 90px" }}>
                  <span>Serves</span>
                  <input
                    type="number"
                    min={1}
                    value={draft.servings}
                    onChange={(e) => patch({ servings: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </label>
              </div>

              <div className="section-h">Ingredients</div>
              <div className="import-ings">
                {draft.ingredients.map((ing, i) => (
                  <div className="import-ing" key={i}>
                    <input
                      className="ing-qty"
                      type="number"
                      step="any"
                      placeholder="qty"
                      value={ing.qty ?? ""}
                      onChange={(e) => patchIng(i, { qty: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                    <input
                      className="ing-unit"
                      placeholder="unit"
                      value={ing.unit}
                      onChange={(e) => patchIng(i, { unit: e.target.value })}
                    />
                    <input
                      className="ing-item"
                      placeholder="ingredient"
                      value={ing.item}
                      onChange={(e) => patchIng(i, { item: e.target.value })}
                    />
                    <select
                      className="ing-section"
                      value={ing.section}
                      onChange={(e) => patchIng(i, { section: e.target.value as Section })}
                    >
                      {SECTION_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {SECTION_LABELS[s].label}
                        </option>
                      ))}
                    </select>
                    <button className="btn ghost small" onClick={() => removeIng(i)} aria-label="Remove ingredient">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button className="btn ghost small" onClick={addIng}>
                + Add ingredient
              </button>

              <label className="cook-field" style={{ marginTop: 12 }}>
                <span>Method</span>
                <textarea rows={6} value={draft.method} onChange={(e) => patch({ method: e.target.value, method_is_link_only: false })} />
              </label>

              <label className="cook-field">
                <span>Notes (optional)</span>
                <textarea rows={2} value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />
              </label>

              {draft.nutrition_estimated && (
                <p className="muted" style={{ fontSize: "0.78rem" }}>
                  No nutrition data was found on the page — it'll show as estimated/zero.
                </p>
              )}

              <div className="row" style={{ marginTop: 12, gap: 8 }}>
                <button className="btn" onClick={save} disabled={!draft.title.trim() || draft.ingredients.every((i) => !i.item.trim())}>
                  Save recipe
                </button>
                <button className="btn ghost" onClick={() => { setDraft(null); setVia(null); }}>
                  Back
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function friendlyError(msg: string): string {
  if (msg.includes("bad_url")) return "That doesn't look like a valid recipe URL.";
  if (msg.includes("fetch_failed")) return "Couldn't load that page (it may block automated access). Try another source.";
  if (msg.includes("no_structured_data")) return "This page has no machine-readable recipe, and AI import isn't configured on the server.";
  if (msg.includes("no_recipe")) return "Couldn't find a recipe on that page.";
  if (msg.includes("ai_failed") || msg.includes("ai_parse")) return "AI extraction failed. Try again, or another source.";
  if (msg.includes("unauthorized")) return "Please sign in to import recipes.";
  return msg;
}
