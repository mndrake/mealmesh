import { useState } from "react";
import type { Recipe } from "./lib/types";
import { recipes, recipesById } from "./lib/recipes";
import { useStore, actions } from "./lib/store";
import { cookedMeals } from "./lib/planner";
import { BrowseView } from "./components/BrowseView";
import { PlannerView } from "./components/PlannerView";
import { ShoppingView } from "./components/ShoppingView";
import { AddToPlanModal } from "./components/AddToPlanModal";
import { exportAllState } from "./lib/exporter";
import { useAuth } from "./lib/auth";

type Tab = "browse" | "plan" | "shopping";
type Slot = "breakfast" | "lunch" | "dinner" | "snack";

export default function App() {
  const [tab, setTab] = useState<Tab>("browse");
  const [addTarget, setAddTarget] = useState<Recipe | null>(null);
  const plan = useStore((s) => s.activePlan);
  const favoritesCount = useStore((s) => s.favorites.length);
  const { email, signOut } = useAuth();

  // count distinct planned meals for the nav badge
  const plannedCount = cookedMeals(plan, recipesById).length;

  function importBackup(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        // accept either a full backup or a {plan} export
        if (data.plan && Array.isArray(data.plan)) {
          actions.setActivePlan(data.plan);
        } else {
          actions.importState(data);
        }
        alert("Import successful.");
      } catch {
        alert("Could not read that file.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <>
      <header className="appbar">
        <div className="appbar-inner">
          <div className="brand">
            <span className="logo">◍</span> MealMesh
          </div>
          <nav className="nav">
            <button className={tab === "browse" ? "active" : ""} onClick={() => setTab("browse")}>
              Browse
              {favoritesCount > 0 && <span className="badge">★{favoritesCount}</span>}
            </button>
            <button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}>
              Plan
              {plannedCount > 0 && <span className="badge">{plannedCount}</span>}
            </button>
            <button
              className={tab === "shopping" ? "active" : ""}
              onClick={() => setTab("shopping")}
            >
              Shopping
            </button>
          </nav>
          <div className="spacer" />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn ghost small"
              onClick={exportAllState}
              title="Download a backup of plans & favorites"
            >
              Backup
            </button>
            <label className="btn ghost small" style={{ margin: 0 }}>
              Import
              <input
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])}
              />
            </label>
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              {recipes.length} recipes
            </span>
            {email && (
              <button
                className="btn ghost small"
                onClick={signOut}
                title={`Signed in as ${email} — sign out`}
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>

      <main>
        {tab === "browse" && <BrowseView onAddToPlan={setAddTarget} />}
        {tab === "plan" && <PlannerView />}
        {tab === "shopping" && <ShoppingView />}
      </main>

      {addTarget && (
        <AddToPlanModal
          recipe={addTarget}
          plan={plan}
          onPick={(di, slot: Slot) => {
            actions.setSlot(di, slot, { id: addTarget.id, leftover: false });
            setAddTarget(null);
            setTab("plan");
          }}
          onClose={() => setAddTarget(null)}
        />
      )}

      <footer className="disclaimer">
        <strong>Disclaimer:</strong> Nutrition figures are per serving and approximate —
        entries marked <span className="est">est.</span> are auto-estimated from ingredient
        quantities, not lab-verified. This tool is for personal meal planning and is{" "}
        <strong>not medical or dietary advice</strong>. Recipes and images are saved for
        personal use only (many photos are representative Wikimedia Commons images); see each
        recipe's source and image attribution. Not for redistribution.
      </footer>
    </>
  );
}
