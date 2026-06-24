// Smoke test: every view renders without throwing (catches hook/undefined bugs
// that tsc + the build can't see). Uses server rendering so no DOM env is needed.
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import App from "../App";
import { BrowseView } from "../components/BrowseView";
import { PlannerView } from "../components/PlannerView";
import { MonthlyPlanView } from "../components/MonthlyPlanView";
import { GenerateRecipesModal } from "../components/GenerateRecipesModal";
import { ShoppingView } from "../components/ShoppingView";
import { HistoryView } from "../components/HistoryView";
import { CoachView, MenuDetail } from "../components/coach/CoachView";
import { CookMode } from "../components/coach/CookMode";
import { SundayOrchestrator } from "../components/coach/SundayOrchestrator";
import { getBlueprint, getMenu } from "../lib/coach/content";

describe("render smoke", () => {
  it("renders the app shell", () => {
    const html = renderToString(<App />);
    expect(html).toContain("MealMesh");
    expect(html).toContain("Disclaimer");
  });

  it("renders the browse view with cards", () => {
    const html = renderToString(<BrowseView onAddToPlan={() => {}} />);
    expect(html).toContain("Recipes");
    expect(html).toContain("count-pill");
    expect(html).toContain("class=\"card\"");
  });

  it("renders the (empty) planner and shopping views", () => {
    expect(renderToString(<PlannerView />)).toContain("Weekly planner");
    expect(renderToString(<ShoppingView />)).toContain("plan is empty");
  });

  it("renders the (empty) history view", () => {
    expect(renderToString(<HistoryView />)).toContain("No cooking history yet");
  });

  it("renders the monthly plan with both rotation weeks and a prep blueprint", () => {
    const html = renderToString(<MonthlyPlanView />);
    expect(html).toContain("Monthly plan");
    expect(html).toContain("Weeks 1 &amp; 3");
    expect(html).toContain("Weeks 2 &amp; 4");
    expect(html).toContain("Weekend prep");
    expect(html).toContain("ingredients to buy this week");
  });

  it("renders the generate-recipes modal form", () => {
    const html = renderToString(<GenerateRecipesModal onClose={() => {}} />);
    expect(html).toContain("Generate recipes");
    expect(html).toContain("Max net carbs");
    expect(html).toContain("No fish");
  });

  // Coach Mode (v2): prove the "selectable" chain renders end-to-end — the weekly menus list,
  // the selected-week view, a recipe's Cook Mode, and the Sunday prep plan.
  it("renders the Coach home with selectable weekly menus", () => {
    const html = renderToString(<CoachView />);
    expect(html).toContain("Cook with Coach");
    expect(html).toContain("Menu A");
    expect(html).toContain("Menu B");
  });

  it("renders a selected week with its recipes and the prep-plan button", () => {
    const html = renderToString(
      <MenuDetail menu={getMenu("month1-a")!} onBack={() => {}} onCook={() => {}} onPrep={() => {}} />
    );
    expect(html).toContain("Sheet-Pan Chicken &amp; Broccoli");
    expect(html).toContain("Run the Sunday prep plan");
    expect(html).toContain("net"); // per-recipe net-carb chips
  });

  it("renders Cook Mode for a selected menu recipe (first step shows)", () => {
    const html = renderToString(
      <CookMode
        recipeId="m1a-mon-sheetpan-chicken-broccoli"
        title="Sheet-Pan Chicken & Broccoli"
        onClose={() => {}}
      />
    );
    expect(html).toContain("Sheet-Pan Chicken");
    expect(html).toContain("Preheat the oven to 425");
    expect(html).toContain("width:25%"); // progress = step 1 of 4
    expect(html).toContain("🆘 Ask"); // step-aware panic button present
  });

  it("renders the Sunday prep Orchestrator for a menu", () => {
    const html = renderToString(
      <SundayOrchestrator blueprint={getBlueprint("month1-a-prep")!} onClose={() => {}} />
    );
    expect(html).toContain("Sunday prep");
    expect(html).toContain("muffin tin");
  });
});
