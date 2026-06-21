// Pure mapping between the app's AppState and Supabase row shapes. No network here —
// cloudStore.ts does the I/O, store.ts orchestrates. Kept pure so it is unit-testable.
import type { Plan, CookEvent, ItemLocation } from "./types";
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

export interface CookLogRow {
  id: string;
  household_id: string;
  recipe_id: string;
  cooked_on: string;
  cooked_by?: string | null;
  rating: number | null;
  make_again: boolean | null;
  notes: string | null;
  plan_id: string | null;
  created_at?: string;
}

export interface ItemLocationRow {
  household_id: string;
  item_name: string;
  aisle: string | null;
  aisle_number: number | null;
  department: string | null;
  fetched_at?: string | null;
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

export function cookEventFromRow(r: CookLogRow): CookEvent {
  return {
    id: r.id,
    recipeId: r.recipe_id,
    cookedOn: r.cooked_on,
    rating: r.rating ?? null,
    makeAgain: r.make_again ?? null,
    notes: r.notes ?? null,
    planId: r.plan_id ?? null,
  };
}

export function itemLocationFromRow(r: ItemLocationRow): ItemLocation {
  return {
    name: r.item_name,
    aisle: r.aisle ?? null,
    aisleNumber: r.aisle_number ?? null,
    department: r.department ?? null,
    fetchedAt: r.fetched_at ? Date.parse(r.fetched_at) : 0,
  };
}

/** Upsert payload for an item location. */
export function itemLocationToRow(l: ItemLocation, householdId: string, userId?: string) {
  return {
    household_id: householdId,
    item_name: l.name,
    aisle: l.aisle,
    aisle_number: l.aisleNumber,
    department: l.department,
    fetched_at: l.fetchedAt ? new Date(l.fetchedAt).toISOString() : null,
    updated_by: userId ?? null,
  };
}

/** Insert payload for a cook event (id/created_at are server-defaulted). */
export function cookEventToRow(e: CookEvent, householdId: string, userId?: string) {
  return {
    id: e.id,
    household_id: householdId,
    recipe_id: e.recipeId,
    cooked_on: e.cookedOn,
    cooked_by: userId ?? null,
    rating: e.rating,
    make_again: e.makeAgain,
    notes: e.notes,
    plan_id: e.planId,
  };
}

/** Assemble a full AppState from the row sets returned by hydrate. */
export function stateFromRows(opts: {
  activePlanRow: PlanRow | null;
  savedPlanRows: PlanRow[];
  favoriteRows: FavoriteRow[];
  checkoffRows: CheckoffRow[];
  cookLogRows: CookLogRow[];
  itemLocationRows: ItemLocationRow[];
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
    cookLog: opts.cookLogRows.map(cookEventFromRow),
    itemLocations: opts.itemLocationRows.map(itemLocationFromRow),
  };
}

/** True when the household has no synced state yet (drives the one-time local import). */
export function householdIsEmpty(opts: {
  activePlanRow: PlanRow | null;
  savedPlanRows: PlanRow[];
  favoriteRows: FavoriteRow[];
  cookLogRows?: CookLogRow[];
}): boolean {
  return (
    !opts.activePlanRow &&
    opts.savedPlanRows.length === 0 &&
    opts.favoriteRows.length === 0 &&
    (opts.cookLogRows?.length ?? 0) === 0
  );
}
