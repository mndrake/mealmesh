// Pure mapping between the app's AppState and Supabase row shapes. No network here —
// cloudStore.ts does the I/O, store.ts orchestrates. Kept pure so it is unit-testable.
import type { Plan, CookEvent, ItemLocation, Recipe } from "./types";
import type { AppState, SavedPlan } from "./store";

/** The durable, persisted subset of AppState (no ephemeral UI flags). */
export type DurableState = Omit<AppState, "loading" | "syncError" | "importAvailable">;

// ---- Row shapes (mirror supabase/migrations/0002_state.sql) ----

/** The plan JSONB column: PlanDay[] plus the per-plan locked-slot keys and the staple
 *  names the user marked "need to buy" (rides here like `locked`, so no extra table). */
export interface PlanData {
  days: Plan;
  locked: string[];
  stapleNeeds?: string[];
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
  price?: number | null;
  product?: string | null;
  quantity?: number | null;
  fetched_at?: string | null;
}

export interface UserRecipeRow {
  id: string;
  household_id: string;
  data: Recipe;
  source_url?: string | null;
  created_at?: string;
}

// ---- AppState -> row payloads (for writes) ----

/** The JSONB body for the active plan. `locked` lives inside the plan blob so the
 *  PlanDay type stays unchanged. */
export function planData(activePlan: Plan, locked: string[], stapleNeeds: string[] = []): PlanData {
  return { days: activePlan, locked, stapleNeeds };
}

/** Insert payload for a saved (inactive) plan. Saved plans don't carry lock/staple state. */
export function savedPlanToRow(sp: SavedPlan, householdId: string) {
  return {
    id: sp.id,
    household_id: householdId,
    name: sp.name,
    data: { days: sp.plan, locked: [], stapleNeeds: [] } as PlanData,
    is_active: false,
  };
}

// ---- Rows -> AppState (for hydrate / realtime) ----

export function activePlanFromRow(row: PlanRow): { activePlan: Plan; locked: string[]; stapleNeeds: string[] } {
  const data = row.data ?? { days: [], locked: [] };
  return { activePlan: data.days ?? [], locked: data.locked ?? [], stapleNeeds: data.stapleNeeds ?? [] };
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
    price: typeof r.price === "number" ? r.price : null,
    product: r.product ?? null,
    ...(typeof r.quantity === "number" ? { quantity: r.quantity } : {}),
    fetchedAt: r.fetched_at ? Date.parse(r.fetched_at) : 0,
  };
}

/** Upsert payload for an item location. `quantity` is omitted when unset so a price-only
 *  refresh doesn't overwrite a user-set quantity (PostgREST only updates provided columns). */
export function itemLocationToRow(l: ItemLocation, householdId: string, userId?: string) {
  const row: Record<string, unknown> = {
    household_id: householdId,
    item_name: l.name,
    aisle: l.aisle,
    aisle_number: l.aisleNumber,
    department: l.department,
    price: l.price,
    product: l.product,
    fetched_at: l.fetchedAt ? new Date(l.fetchedAt).toISOString() : null,
    updated_by: userId ?? null,
  };
  if (typeof l.quantity === "number") row.quantity = l.quantity;
  return row;
}

/** A stored imported recipe (the full Recipe lives in the JSONB `data` column). The row id
 *  is authoritative for the recipe id. */
export function userRecipeFromRow(row: UserRecipeRow): Recipe {
  return { ...row.data, id: row.id };
}

/** Insert/upsert payload for an imported recipe. */
export function userRecipeToRow(r: Recipe, householdId: string, userId?: string) {
  return {
    id: r.id,
    household_id: householdId,
    data: r,
    source_url: r.source?.url ?? null,
    created_by: userId ?? null,
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
  userRecipeRows: UserRecipeRow[];
  emptyPlan: () => Plan;
}): DurableState {
  const active = opts.activePlanRow
    ? activePlanFromRow(opts.activePlanRow)
    : { activePlan: opts.emptyPlan(), locked: [], stapleNeeds: [] };
  return {
    activePlan: active.activePlan,
    locked: active.locked,
    stapleNeeds: active.stapleNeeds,
    savedPlans: opts.savedPlanRows.map(savedPlanFromRow),
    favorites: favoritesFromRows(opts.favoriteRows),
    checked: checkedFromRows(opts.checkoffRows),
    cookLog: opts.cookLogRows.map(cookEventFromRow),
    itemLocations: opts.itemLocationRows.map(itemLocationFromRow),
    userRecipes: opts.userRecipeRows.map(userRecipeFromRow),
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
