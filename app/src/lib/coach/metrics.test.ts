import { describe, it, expect } from "vitest";
import { cookModeCompletionCount, cookModeCompletions } from "./metrics";
import type { CookEvent } from "../types";

const ev = (id: string, source?: CookEvent["source"]): CookEvent => ({
  id,
  recipeId: "r",
  cookedOn: "2026-06-23",
  rating: null,
  makeAgain: null,
  notes: null,
  planId: null,
  source: source ?? null,
});

describe("cook mode metrics", () => {
  it("counts only cook_mode-sourced completions", () => {
    const log = [ev("a", "cook_mode"), ev("b"), ev("c", "cook_mode"), ev("d", null)];
    expect(cookModeCompletionCount(log)).toBe(2);
    expect(cookModeCompletions(log).map((e) => e.id)).toEqual(["a", "c"]);
  });
  it("is zero for an all-manual log", () => {
    expect(cookModeCompletionCount([ev("a"), ev("b")])).toBe(0);
  });
});
