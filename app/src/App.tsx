import { lazy, Suspense, useEffect, useState } from "react";
import type { Recipe } from "./lib/types";
import { useAllRecipes, useAllRecipesById } from "./lib/allRecipes";
import { useStore, actions } from "./lib/store";
import { cookedMeals } from "./lib/planner";
import { AddToPlanModal } from "./components/AddToPlanModal";
import { HelpModal } from "./components/HelpModal";
import { CloudStatus } from "./components/CloudStatus";
import { coachEnabled } from "./lib/coach/flag";
import { exportAllState } from "./lib/exporter";
import { useAuth } from "./lib/auth";

// Tab views are code-split into their own chunks so the initial bundle stays small — the
// heavy ones (Coach's bundled menu data, the Monthly planner, Shopping) load on first visit.
const BrowseView = lazy(() => import("./components/BrowseView").then((m) => ({ default: m.BrowseView })));
const PlannerView = lazy(() => import("./components/PlannerView").then((m) => ({ default: m.PlannerView })));
const MonthlyPlanView = lazy(() => import("./components/MonthlyPlanView").then((m) => ({ default: m.MonthlyPlanView })));
const ShoppingView = lazy(() => import("./components/ShoppingView").then((m) => ({ default: m.ShoppingView })));
const HistoryView = lazy(() => import("./components/HistoryView").then((m) => ({ default: m.HistoryView })));
const CoachView = lazy(() => import("./components/coach/CoachView").then((m) => ({ default: m.CoachView })));

type Tab = "browse" | "plan" | "monthly" | "shopping" | "history" | "coach";
type Slot = "breakfast" | "lunch" | "dinner" | "snack";

export default function App() {
  // Detect the Kroger OAuth return once, from the URL on first render. Deriving it here
  // (rather than setting state in an effect) lets us open the shopping tab immediately.
  const [krogerReturn] = useState(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("kroger")
  );
  const krogerConnected = krogerReturn === "connected";
  // Menu-first front door: when Coach is on, land on "pick a week" rather than Browse, so the
  // family-planning flow (pick week → shop → prep → cook) starts where you enter.
  const [tab, setTab] = useState<Tab>(
    krogerConnected ? "shopping" : coachEnabled() ? "coach" : "browse"
  );
  const [addTarget, setAddTarget] = useState<Recipe | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const plan = useStore((s) => s.activePlan);
  const favoritesCount = useStore((s) => s.favorites.length);
  const cookedCount = useStore((s) => s.cookLog.length);
  const recipes = useAllRecipes();
  const recipesById = useAllRecipesById();
  const { email, signOut } = useAuth();
  const showCoach = coachEnabled();

  // Clean the ?kroger= param from the URL (and surface a connect error). No setState here.
  useEffect(() => {
    if (!krogerReturn) return;
    if (krogerReturn === "error") alert("Couldn't connect to Kroger. Please try again.");
    window.history.replaceState({}, "", window.location.pathname);
  }, [krogerReturn]);

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
          {/* Ordered to match the planning flow: pick a week (Coach) → Plan → Shopping → cook
              (History), with Browse/Monthly as secondary discovery. */}
          <nav className="nav">
            {showCoach && (
              <button className={tab === "coach" ? "active" : ""} onClick={() => setTab("coach")}>
                Coach 🍳
              </button>
            )}
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
            <button
              className={tab === "history" ? "active" : ""}
              onClick={() => setTab("history")}
            >
              History
              {cookedCount > 0 && <span className="badge">{cookedCount}</span>}
            </button>
            <button className={tab === "browse" ? "active" : ""} onClick={() => setTab("browse")}>
              Browse
              {favoritesCount > 0 && <span className="badge">★{favoritesCount}</span>}
            </button>
            <button className={tab === "monthly" ? "active" : ""} onClick={() => setTab("monthly")}>
              Monthly
            </button>
          </nav>
          <div className="spacer" />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn ghost small"
              onClick={() => setShowHelp(true)}
              title="How MealMesh works"
              aria-label="Help"
            >
              ? Help
            </button>
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
        <div className="container" style={{ paddingBottom: 0 }}>
          <CloudStatus />
        </div>
        <Suspense
          fallback={
            <div className="container">
              <p className="muted">Loading…</p>
            </div>
          }
        >
          {tab === "browse" && <BrowseView onAddToPlan={setAddTarget} />}
          {tab === "plan" && <PlannerView />}
          {tab === "monthly" && <MonthlyPlanView />}
          {tab === "shopping" && <ShoppingView openSend={krogerConnected} />}
          {tab === "history" && <HistoryView />}
          {tab === "coach" && showCoach && (
            <CoachView
              onOpenPlan={() => setTab("plan")}
              onOpenShopping={() => setTab("shopping")}
            />
          )}
        </Suspense>
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

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

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
