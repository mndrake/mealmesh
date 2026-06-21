// Data-verification pass: the real recipe dataset shouldn't surface non-US ingredient
// names on the shopping list (they hurt Kroger matching). normalize.ts maps them to US
// names; this guards coverage and catches regressions when recipes are re-synced.
import { describe, it, expect } from "vitest";
import { rawRecipes } from "../recipes";
import { normalizeForShopping } from "../normalize";

// British/non-US names that should never appear as a shopping (buy) item name.
const NON_US = new Set([
  "rocket",
  "aubergine",
  "aubergines",
  "courgette",
  "courgettes",
  "coriander",
  "coriander leaves",
  "spring onions",
  "spring onion",
  "beetroot",
  "swede",
  "chilli",
  "red chilli",
  "green chilli",
  "double cream",
  "single cream",
  "caster sugar",
  "icing sugar",
  "plain flour",
  "self-raising flour",
  "cornflour",
  "minced beef",
  "lamb mince",
  "minced pork",
  "prawns",
  "prawn",
  "broken tortilla chips",
]);

describe("US ingredient naming over the real dataset", () => {
  it("no non-US name survives shopping normalization", () => {
    const offenders = new Set<string>();
    for (const r of normalizeForShopping(rawRecipes)) {
      for (const ing of r.ingredients) {
        if (ing.exclude_from_shopping) continue;
        const buy = (ing.buy_as || ing.item).toLowerCase();
        if (NON_US.has(buy)) offenders.add(buy);
      }
    }
    expect([...offenders]).toEqual([]);
  });
});
