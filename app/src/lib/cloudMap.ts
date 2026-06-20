// Pure mapping between the app's AppState and Supabase row shapes. No network here —
// cloudStore.ts does the I/O, store.ts orchestrates. Kept pure so it is unit-testable.
import type { Plan } from "./types";
import type { AppState, SavedPlan } from "./store";

/** The durable, persisted subset of AppState (no ephemeral UI flags). */
export type DurableState = Omit<AppState, "loading" | "syncError" | "importAvailable">;

// ---- Row shapes (mirror supabase/migrations/0002_state.sql) ----

/** The plan JSONB column: PlanDay[] plus the per-plan locked-slot keys. */
export interface PlanData {
  days: Plan;
  locked: string[];
}

export interface PlanRow {
  id: string;
  household_id: string;
  name: string;
  data: PlanData;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  updated_by?: string | null;
}

export interface FavoriteRow {
  household_id: string;
  recipe_id: string;
}

export interface CheckoffRow {
  plan_id: string;
  item_name: string;
}

// ---- AppState -> row payloads (for writes) ----

/** The JSONB body for the active plan. `locked` lives inside the plan blob so the
 *  PlanDay type stays unchanged. */
export function planData(activePlan: Plan, locked: string[]): PlanData {
  return { days: activePlan, locked };
}

/** Insert payload for a saved (inactive) plan. Saved plans don't carry lock state. */
export function savedPlanToRow(sp: SavedPlan, householdId: string) {
  return {
    id: sp.id,
    household_id: householdId,
    name: sp.name,
    data: { days: sp.plan, locked: [] } as PlanData,
    is_active: false,
  };
}

// ---- Rows -> AppState (for hydrate / realtime) ----

export function activePlanFromRow(row: PlanRow): { activePlan: Plan; locked: string[] } {
  const data = row.data ?? { days: [], locked: [] };
  return { activePlan: data.days ?? [], locked: data.locked ?? [] };
}

export function savedPlanFromRow(row: PlanRow): SavedPlan {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    plan: row.data?.days ?? [],
  };
}

export function favoritesFromRows(rows: FavoriteRow[]): string[] {
  return rows.map((r) => r.recipe_id).sort();
}

export function checkedFromRows(rows: CheckoffRow[]): string[] {
  return rows.map((r) => r.item_name);
}

/** Assemble a full AppState from the four row sets returned by hydrate. */
export function stateFromRows(opts: {
  activePlanRow: PlanRow | null;
  savedPlanRows: PlanRow[];
  favoriteRows: FavoriteRow[];
  checkoffRows: CheckoffRow[];
  emptyPlan: () => Plan;
}): DurableState {
  const active = opts.activePlanRow
    ? activePlanFromRow(opts.activePlanRow)
    : { activePlan: opts.emptyPlan(), locked: [] };
  return {
    activePlan: active.activePlan,
    locked: active.locked,
    savedPlans: opts.savedPlanRows.map(savedPlanFromRow),
    favorites: favoritesFromRows(opts.favoriteRows),
    checked: checkedFromRows(opts.checkoffRows),
  };
}

/** True when the household has no synced state yet (drives the one-time local import). */
export function householdIsEmpty(opts: {
  activePlanRow: PlanRow | null;
  savedPlanRows: PlanRow[];
  favoriteRows: FavoriteRow[];
}): boolean {
  return (
    !opts.activePlanRow && opts.savedPlanRows.length === 0 && opts.favoriteRows.length === 0
  );
}
