import { describe, it, expect } from "vitest";
import {
  summarize,
  recentCooks,
  daysSince,
  formatCookedOn,
  historyLabel,
  todayIso,
} from "./history";
import type { CookEvent } from "./types";

const ev = (id: string, recipeId: string, cookedOn: string, extra: Partial<CookEvent> = {}): CookEvent => ({
  id,
  recipeId,
  cookedOn,
  rating: null,
  makeAgain: null,
  notes: null,
  planId: null,
  ...extra,
});

describe("history.summarize", () => {
  it("counts per recipe and keeps the latest date + that day's feedback", () => {
    const log = [
      ev("1", "a", "2026-01-10", { rating: 3, makeAgain: false }),
      ev("2", "a", "2026-06-02", { rating: 5, makeAgain: true }),
      ev("3", "b", "2026-05-01"),
    ];
    const s = summarize(log);
    expect(s.get("a")).toEqual({ timesMade: 2, lastMade: "2026-06-02", lastRating: 5, lastMakeAgain: true });
    expect(s.get("b")).toEqual({ timesMade: 1, lastMade: "2026-05-01", lastRating: null, lastMakeAgain: null });
    expect(s.get("c")).toBeUndefined();
  });

  it("is order-independent (latest wins regardless of input order)", () => {
    const s = summarize([ev("2", "a", "2026-06-02", { rating: 5 }), ev("1", "a", "2026-01-10", { rating: 2 })]);
    expect(s.get("a")?.lastMade).toBe("2026-06-02");
    expect(s.get("a")?.lastRating).toBe(5);
  });
});

describe("history formatting", () => {
  const now = new Date("2026-06-21T12:00:00");

  it("recentCooks sorts newest-first, stable by id", () => {
    const log = [ev("1", "a", "2026-01-01"), ev("3", "b", "2026-06-02"), ev("2", "c", "2026-06-02")];
    expect(recentCooks(log).map((e) => e.id)).toEqual(["3", "2", "1"]);
  });

  it("daysSince counts whole days and clamps to 0", () => {
    expect(daysSince("2026-06-21", now)).toBe(0);
    expect(daysSince("2026-06-14", now)).toBe(7);
    expect(daysSince("2099-01-01", now)).toBe(0);
  });

  it("formatCookedOn hides the current year and shows older years", () => {
    expect(formatCookedOn("2026-06-02", now)).toBe("Jun 2");
    expect(formatCookedOn("2025-12-25", now)).toBe("Dec 25 2025");
  });

  it("historyLabel renders a compact summary", () => {
    expect(historyLabel(undefined, now)).toBe("");
    expect(historyLabel({ timesMade: 3, lastMade: "2026-06-02", lastRating: null, lastMakeAgain: null }, now)).toBe(
      "Made 3× · last Jun 2"
    );
  });

  it("todayIso zero-pads month/day", () => {
    expect(todayIso(new Date("2026-03-07T09:00:00"))).toBe("2026-03-07");
  });
});
