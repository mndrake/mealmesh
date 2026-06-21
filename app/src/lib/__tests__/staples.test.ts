import { describe, it, expect } from "vitest";
import { isStaple } from "../staples";
import { normalizeIngredientForShopping } from "../normalize";
import type { Ingredient } from "../types";

const ing = (over: Partial<Ingredient>): Ingredient => ({
  qty: 1, unit: "", item: "x", section: "Pantry & Dry Goods", perishable: false, staple: false, ...over,
});

describe("isStaple", () => {
  it("treats everything in Condiments & Spices as a staple", () => {
    expect(isStaple("salt", "Condiments & Spices")).toBe(true);
    expect(isStaple("gochujang", "Condiments & Spices")).toBe(true);
    expect(isStaple("olive oil", "Condiments & Spices")).toBe(true);
  });
  it("treats curated baking/pantry basics as staples", () => {
    expect(isStaple("all-purpose flour", "Pantry & Dry Goods")).toBe(true);
    expect(isStaple("baking powder", "Pantry & Dry Goods")).toBe(true);
    expect(isStaple("cornstarch", "Pantry & Dry Goods")).toBe(true);
    expect(isStaple("Vanilla Extract", "Pantry & Dry Goods")).toBe(true); // case-insensitive
  });
  it("does not treat ordinary groceries as staples", () => {
    expect(isStaple("rice", "Pantry & Dry Goods")).toBe(false);
    expect(isStaple("chicken breast", "Meat & Poultry")).toBe(false);
    expect(isStaple("onion", "Produce")).toBe(false);
  });
});

describe("normalizeIngredientForShopping staple flag", () => {
  it("forces a consistent staple flag regardless of the source flag", () => {
    // Source said NOT a staple, but it's a condiment -> staple.
    expect(normalizeIngredientForShopping(ing({ item: "soy sauce", section: "Condiments & Spices", staple: false })).staple).toBe(true);
    // Source said staple, but it's a normal grocery -> not a staple.
    expect(normalizeIngredientForShopping(ing({ item: "rice", section: "Pantry & Dry Goods", staple: true })).staple).toBe(false);
  });
  it("classifies on the post-override section (e.g. garlic powder moved to Condiments)", () => {
    // normalize moves "garlic powder" to Condiments & Spices -> staple, consistently.
    expect(normalizeIngredientForShopping(ing({ item: "garlic powder", section: "Produce", staple: false })).staple).toBe(true);
  });
  it("still excludes non-grocery items like water", () => {
    expect(normalizeIngredientForShopping(ing({ item: "water" })).exclude_from_shopping).toBe(true);
  });
});
