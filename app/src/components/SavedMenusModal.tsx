// Saved weekly menus: save the current week under a name, then load / rename / delete any
// saved menu for reuse. Backed by the synced savedPlans (plans table, is_active=false).
import { useEffect, useState } from "react";
import { useStore, actions } from "../lib/store";
import { recipesById } from "../lib/recipes";
import { cookedMeals } from "../lib/planner";
import { formatCookedOn, todayIso } from "../lib/history";

const fmtDate = (ms: number) => (ms ? formatCookedOn(todayIso(new Date(ms))) : "");

export function SavedMenusModal({ onClose }: { onClose: () => void }) {
  const savedPlans = useStore((s) => s.savedPlans);
  const [name, setName] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    const n = name.trim();
    if (!n) return;
    actions.savePlanAs(n);
    setName("");
  }

  const sorted = [...savedPlans].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="content">
          <h2 style={{ marginTop: 0 }}>📚 Saved menus</h2>

          <div className="row" style={{ gap: 6, marginBottom: 12 }}>
            <input
              className="search"
              placeholder="Name this week's menu…"
              value={name}
              style={{ flex: 1 }}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
            <button className="btn" onClick={save} disabled={!name.trim()}>
              Save current week
            </button>
          </div>

          {sorted.length === 0 ? (
            <p className="muted">No saved menus yet. Name the current week above to save it for reuse.</p>
          ) : (
            <div className="menu-list">
              {sorted.map((p) => {
                const meals = cookedMeals(p.plan, recipesById).length;
                return (
                  <div className="menu-row" key={p.id}>
                    <div className="menu-main">
                      <span className="menu-name">{p.name}</span>
                      <span className="muted" style={{ fontSize: "0.76rem" }}>
                        {meals} meal{meals === 1 ? "" : "s"}
                        {p.createdAt ? ` · saved ${fmtDate(p.createdAt)}` : ""}
                      </span>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        className="btn small"
                        onClick={() => {
                          actions.loadPlan(p.id);
                          onClose();
                        }}
                      >
                        Load
                      </button>
                      <button
                        className="btn secondary small"
                        onClick={() => {
                          const n = prompt("Rename menu:", p.name);
                          if (n && n.trim()) actions.renamePlan(p.id, n);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="btn ghost small"
                        onClick={() => confirm(`Delete menu "${p.name}"?`) && actions.deletePlan(p.id)}
                        aria-label={`Delete ${p.name}`}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="muted" style={{ fontSize: "0.76rem", marginTop: 12 }}>
            Loading a menu replaces the current week's plan. Saved menus sync across your
            family's devices.
          </p>
        </div>
      </div>
    </div>
  );
}
