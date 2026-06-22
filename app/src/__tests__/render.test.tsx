// Smoke test: every view renders without throwing (catches hook/undefined bugs
// that tsc + the build can't see). Uses server rendering so no DOM env is needed.
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import App from "../App";
import { BrowseView } from "../components/BrowseView";
import { PlannerView } from "../components/PlannerView";
import { MonthlyPlanView } from "../components/MonthlyPlanView";
import { ShoppingView } from "../components/ShoppingView";
import { HistoryView } from "../components/HistoryView";

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
});
