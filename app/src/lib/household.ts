// Persisted "cooking for N people" setting (a local UI preference, not household-synced state).
// 0 = "as written" — use each recipe's own serving count, which preserves the parity-locked
// default weekly shopping list. Any N >= 1 scales the shopping list to N servings per meal.
import { useCallback, useState } from "react";

const KEY = "mealmesh.householdSize.v1";
export const MAX_HOUSEHOLD = 12;

export function getHouseholdSize(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n >= 1 ? Math.min(MAX_HOUSEHOLD, Math.floor(n)) : 0;
  } catch {
    return 0;
  }
}

export function setHouseholdSize(n: number): void {
  try {
    if (n >= 1) localStorage.setItem(KEY, String(Math.min(MAX_HOUSEHOLD, Math.floor(n))));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** React hook: [size, setSize]. size is 0 when unset ("as written"). */
export function useHouseholdSize(): [number, (n: number) => void] {
  const [size, setSize] = useState(getHouseholdSize);
  const set = useCallback((n: number) => {
    setHouseholdSize(n);
    setSize(getHouseholdSize());
  }, []);
  return [size, set];
}
