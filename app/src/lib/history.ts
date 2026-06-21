// Pure derivations over the cook-log (M3). No network/state here — store.ts holds the
// CookEvent[] (hydrated from Supabase); components call these to render "made N× · last …".
import type { CookEvent } from "./types";

export interface RecipeHistory {
  timesMade: number;
  lastMade: string | null; // 'YYYY-MM-DD'
  lastRating: number | null;
  lastMakeAgain: boolean | null;
}

/** Index the cook-log by recipe id: count, most-recent date, and that day's feedback. */
export function summarize(log: CookEvent[]): Map<string, RecipeHistory> {
  const byRecipe = new Map<string, RecipeHistory>();
  for (const e of log) {
    const prev = byRecipe.get(e.recipeId);
    if (!prev) {
      byRecipe.set(e.recipeId, {
        timesMade: 1,
        lastMade: e.cookedOn,
        lastRating: e.rating,
        lastMakeAgain: e.makeAgain,
      });
      continue;
    }
    prev.timesMade += 1;
    // Keep the latest event's date + feedback (string compare works for ISO dates).
    if (e.cookedOn >= (prev.lastMade ?? "")) {
      prev.lastMade = e.cookedOn;
      prev.lastRating = e.rating;
      prev.lastMakeAgain = e.makeAgain;
    }
  }
  return byRecipe;
}

/** Cook events newest-first (ties broken by id for stable ordering). */
export function recentCooks(log: CookEvent[]): CookEvent[] {
  return [...log].sort((a, b) =>
    a.cookedOn === b.cookedOn ? b.id.localeCompare(a.id) : b.cookedOn.localeCompare(a.cookedOn)
  );
}

/** Whole days between an ISO date and `now` (local midnight). Negative dates → 0. */
export function daysSince(isoDate: string, now: Date = new Date()): number {
  const then = new Date(isoDate + "T00:00:00");
  const ms = now.getTime() - then.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jun 2" / "Jun 2 2025" (year shown only when not the current year). */
export function formatCookedOn(isoDate: string, now: Date = new Date()): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const base = `${MONTHS[m - 1]} ${d}`;
  return y === now.getFullYear() ? base : `${base} ${y}`;
}

/** Compact label for cards/detail: "Made 3× · last Jun 2". Empty string if never made. */
export function historyLabel(h: RecipeHistory | undefined, now: Date = new Date()): string {
  if (!h || h.timesMade === 0) return "";
  const times = `Made ${h.timesMade}×`;
  return h.lastMade ? `${times} · last ${formatCookedOn(h.lastMade, now)}` : times;
}

/** Today's local date as 'YYYY-MM-DD' (for default cooked_on). */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
