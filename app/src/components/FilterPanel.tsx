import type { Category, PrepStyle } from "../lib/types";
import { type Filters, DIET_TAGS } from "../lib/filters";

const CATEGORIES: Category[] = ["breakfast", "lunch", "dinner", "snack"];
const PREP_STYLES: PrepStyle[] = ["no_cook", "make_ahead", "cook"];

interface Props {
  filters: Filters;
  cuisines: Map<string, string>; // lc -> display
  onChange: (next: Filters) => void;
  onReset: () => void;
}

export function FilterPanel({ filters, cuisines, onChange, onReset }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  const toggleCategory = (c: Category) =>
    set({
      categories: filters.categories.includes(c)
        ? filters.categories.filter((x) => x !== c)
        : [...filters.categories, c],
    });

  const toggleTag = (t: string) =>
    set({
      tags: filters.tags.includes(t)
        ? filters.tags.filter((x) => x !== t)
        : [...filters.tags, t],
    });

  const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));

  return (
    <div className="filters">
      <input
        className="search"
        placeholder="Search recipes, ingredients, cuisine…"
        value={filters.search}
        onChange={(e) => set({ search: e.target.value })}
      />

      <div className="grid">
        <div className="field">
          <label>Cuisine</label>
          <select
            value={filters.cuisine ?? ""}
            onChange={(e) => set({ cuisine: e.target.value || null })}
          >
            <option value="">Any</option>
            {[...cuisines.entries()]
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([lc, display]) => (
                <option key={lc} value={lc}>
                  {display}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label>Prep style</label>
          <select
            value={filters.prepStyle ?? ""}
            onChange={(e) => set({ prepStyle: (e.target.value || null) as PrepStyle | null })}
          >
            <option value="">Any</option>
            {PREP_STYLES.map((p) => (
              <option key={p} value={p}>
                {p.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Max carbs (g)</label>
          <input
            type="number"
            min={0}
            value={filters.maxCarbs ?? ""}
            onChange={(e) => set({ maxCarbs: num(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>Max calories</label>
          <input
            type="number"
            min={0}
            value={filters.maxKcal ?? ""}
            onChange={(e) => set({ maxKcal: num(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>Max total time (min)</label>
          <input
            type="number"
            min={0}
            value={filters.maxTotalTime ?? ""}
            onChange={(e) => set({ maxTotalTime: num(e.target.value) })}
          />
        </div>
      </div>

      <div className="toggles">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className={`toggle ${filters.categories.includes(c) ? "on" : ""}`}
            onClick={() => toggleCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="toggles">
        {DIET_TAGS.map((t) => (
          <button
            key={t}
            className={`toggle ${filters.tags.includes(t) ? "on" : ""}`}
            onClick={() => toggleTag(t)}
          >
            {t}
          </button>
        ))}
        <button
          className={`toggle ${filters.realNutritionOnly ? "on" : ""}`}
          onClick={() => set({ realNutritionOnly: !filters.realNutritionOnly })}
          title="Show only recipes with published (non-estimated) nutrition"
        >
          published nutrition
        </button>
        <button
          className={`toggle ${filters.favoritesOnly ? "on" : ""}`}
          onClick={() => set({ favoritesOnly: !filters.favoritesOnly })}
        >
          ★ favorites
        </button>
        <button className="btn ghost small" onClick={onReset}>
          Reset
        </button>
      </div>
    </div>
  );
}
