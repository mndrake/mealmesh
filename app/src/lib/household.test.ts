import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getHouseholdSize, setHouseholdSize, MAX_HOUSEHOLD } from "./household";

// The node test env has no persistent localStorage, so back it with an in-memory shim.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("household size setting", () => {
  it("defaults to 0 (as written) when unset", () => {
    expect(getHouseholdSize()).toBe(0);
  });

  it("persists a set size", () => {
    setHouseholdSize(4);
    expect(getHouseholdSize()).toBe(4);
  });

  it("clamps to the max and floors fractions", () => {
    setHouseholdSize(99);
    expect(getHouseholdSize()).toBe(MAX_HOUSEHOLD);
    setHouseholdSize(3.7);
    expect(getHouseholdSize()).toBe(3);
  });

  it("clearing (n < 1) reverts to as-written", () => {
    setHouseholdSize(4);
    setHouseholdSize(0);
    expect(getHouseholdSize()).toBe(0);
  });
});
