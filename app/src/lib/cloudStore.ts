// Supabase data-access for synced state. Thin async I/O over supabase.from(...); all
// row<->state shaping lives in cloudMap.ts. store.ts orchestrates (optimistic + reconcile).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppState } from "./store";
import {
  planData,
  savedPlanToRow,
  cookEventToRow,
  itemLocationToRow,
  stateFromRows,
  householdIsEmpty,
  type DurableState,
  type PlanRow,
  type FavoriteRow,
  type CheckoffRow,
  type CookLogRow,
  type ItemLocationRow,
} from "./cloudMap";
import type { Plan, CookEvent, ItemLocation } from "./types";

export interface HydrateResult {
  state: DurableState;
  activePlanId: string | null;
  isEmpty: boolean;
}

/** Load the whole household state in a few queries. */
export async function hydrate(
  client: SupabaseClient,
  householdId: string,
  emptyPlan: () => Plan
): Promise<HydrateResult> {
  const [plansRes, favRes, cookRes, locRes] = await Promise.all([
    client.from("plans").select("*").eq("household_id", householdId),
    client.from("favorites").select("household_id,recipe_id").eq("household_id", householdId),
    client
      .from("cook_log")
      .select("id,recipe_id,cooked_on,rating,make_again,notes,plan_id")
      .eq("household_id", householdId)
      .order("cooked_on", { ascending: false }),
    client
      .from("item_locations")
      .select("item_name,aisle,aisle_number,department,fetched_at")
      .eq("household_id", householdId),
  ]);
  if (plansRes.error) throw plansRes.error;
  if (favRes.error) throw favRes.error;
  if (cookRes.error) throw cookRes.error;
  if (locRes.error) throw locRes.error;

  const planRows = (plansRes.data ?? []) as PlanRow[];
  const activePlanRow = planRows.find((r) => r.is_active) ?? null;
  const savedPlanRows = planRows.filter((r) => !r.is_active);
  const favoriteRows = (favRes.data ?? []) as FavoriteRow[];
  const cookLogRows = (cookRes.data ?? []) as CookLogRow[];
  const itemLocationRows = (locRes.data ?? []) as ItemLocationRow[];

  let checkoffRows: CheckoffRow[] = [];
  if (activePlanRow) {
    const coRes = await client
      .from("shopping_checkoffs")
      .select("plan_id,item_name")
      .eq("plan_id", activePlanRow.id);
    if (coRes.error) throw coRes.error;
    checkoffRows = (coRes.data ?? []) as CheckoffRow[];
  }

  return {
    state: stateFromRows({ activePlanRow, savedPlanRows, favoriteRows, checkoffRows, cookLogRows, itemLocationRows, emptyPlan }),
    activePlanId: activePlanRow?.id ?? null,
    isEmpty: householdIsEmpty({ activePlanRow, savedPlanRows, favoriteRows, cookLogRows }),
  };
}

/** Upsert item locations (household-scoped cache; keyed by item name). */
export async function upsertItemLocations(
  client: SupabaseClient,
  locations: ItemLocation[],
  householdId: string,
  userId?: string
): Promise<void> {
  if (!locations.length) return;
  const rows = locations.map((l) => itemLocationToRow(l, householdId, userId));
  const { error } = await client.from("item_locations").upsert(rows, { onConflict: "household_id,item_name" });
  if (error) throw error;
}

/** Insert one cook event for the household. */
export async function insertCookEvent(
  client: SupabaseClient,
  event: CookEvent,
  householdId: string,
  userId?: string
): Promise<void> {
  const { error } = await client.from("cook_log").insert(cookEventToRow(event, householdId, userId));
  if (error) throw error;
}

export async function deleteCookEvent(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("cook_log").delete().eq("id", id);
  if (error) throw error;
}

export async function updateCookEvent(
  client: SupabaseClient,
  id: string,
  patch: { cookedOn?: string; rating?: number | null; makeAgain?: boolean | null; notes?: string | null }
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.cookedOn !== undefined) row.cooked_on = patch.cookedOn;
  if (patch.rating !== undefined) row.rating = patch.rating;
  if (patch.makeAgain !== undefined) row.make_again = patch.makeAgain;
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { error } = await client.from("cook_log").update(row).eq("id", id);
  if (error) throw error;
}

/** Upsert the active plan's days+locked. Inserts the active row if none exists yet;
 *  returns the active plan id. */
export async function writeActivePlan(
  client: SupabaseClient,
  opts: { householdId: string; planId: string | null; activePlan: Plan; locked: string[]; userId?: string }
): Promise<string> {
  const data = planData(opts.activePlan, opts.locked);
  if (opts.planId) {
    const { error } = await client
      .from("plans")
      .update({ data, updated_by: opts.userId ?? null })
      .eq("id", opts.planId);
    if (error) throw error;
    return opts.planId;
  }
  const { data: inserted, error } = await client
    .from("plans")
    .insert({ household_id: opts.householdId, name: "This week", data, is_active: true, updated_by: opts.userId ?? null })
    .select("id")
    .single();
  if (error) throw error;
  return inserted!.id as string;
}

export async function insertSavedPlan(
  client: SupabaseClient,
  sp: { id: string; name: string; plan: Plan },
  householdId: string
): Promise<void> {
  const { error } = await client.from("plans").insert(savedPlanToRow(sp as never, householdId));
  if (error) throw error;
}

export async function deleteSavedPlan(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("plans").delete().eq("id", id).eq("is_active", false);
  if (error) throw error;
}

export async function renameSavedPlan(client: SupabaseClient, id: string, name: string): Promise<void> {
  const { error } = await client.from("plans").update({ name }).eq("id", id).eq("is_active", false);
  if (error) throw error;
}

/** Overwrite a saved plan's days with `plan` (used by "update existing menu"). */
export async function updateSavedPlan(client: SupabaseClient, id: string, plan: Plan): Promise<void> {
  const { error } = await client.from("plans").update({ data: planData(plan, []) }).eq("id", id).eq("is_active", false);
  if (error) throw error;
}

export async function setFavorite(
  client: SupabaseClient,
  householdId: string,
  recipeId: string,
  on: boolean
): Promise<void> {
  const q = on
    ? client.from("favorites").upsert({ household_id: householdId, recipe_id: recipeId })
    : client.from("favorites").delete().eq("household_id", householdId).eq("recipe_id", recipeId);
  const { error } = await q;
  if (error) throw error;
}

export async function setCheckoff(
  client: SupabaseClient,
  planId: string,
  itemName: string,
  on: boolean
): Promise<void> {
  const q = on
    ? client.from("shopping_checkoffs").upsert({ plan_id: planId, item_name: itemName })
    : client.from("shopping_checkoffs").delete().eq("plan_id", planId).eq("item_name", itemName);
  const { error } = await q;
  if (error) throw error;
}

export async function clearCheckoffs(client: SupabaseClient, planId: string): Promise<void> {
  const { error } = await client.from("shopping_checkoffs").delete().eq("plan_id", planId);
  if (error) throw error;
}

/** Replace the household's synced state with `state`. Used for the one-time local
 *  import (into an empty household) and for JSON-backup restore (overwrites). Saved
 *  plans get fresh UUIDs (local ids may not be UUIDs). Returns the active plan id. */
export async function pushFullState(
  client: SupabaseClient,
  householdId: string,
  activePlanId: string | null,
  state: AppState
): Promise<string> {
  const planId = await writeActivePlan(client, {
    householdId,
    planId: activePlanId,
    activePlan: state.activePlan,
    locked: state.locked,
  });

  // Saved plans: replace the inactive rows wholesale.
  const { error: delSaved } = await client
    .from("plans")
    .delete()
    .eq("household_id", householdId)
    .eq("is_active", false);
  if (delSaved) throw delSaved;
  if (state.savedPlans.length) {
    const rows = state.savedPlans.map((sp) =>
      savedPlanToRow({ ...sp, id: crypto.randomUUID() }, householdId)
    );
    const { error } = await client.from("plans").insert(rows);
    if (error) throw error;
  }

  // Favorites: replace.
  const { error: delFav } = await client.from("favorites").delete().eq("household_id", householdId);
  if (delFav) throw delFav;
  if (state.favorites.length) {
    const rows = state.favorites.map((recipe_id) => ({ household_id: householdId, recipe_id }));
    const { error } = await client.from("favorites").insert(rows);
    if (error) throw error;
  }

  // Check-offs for the active plan: replace.
  await clearCheckoffs(client, planId);
  if (state.checked.length) {
    const rows = state.checked.map((item_name) => ({ plan_id: planId, item_name }));
    const { error } = await client.from("shopping_checkoffs").insert(rows);
    if (error) throw error;
  }

  // Cook log: replace wholesale (fresh UUIDs; local ids may not be UUIDs). plan_id is
  // dropped since saved/active plan ids are remapped on import.
  const { error: delCook } = await client.from("cook_log").delete().eq("household_id", householdId);
  if (delCook) throw delCook;
  if (state.cookLog.length) {
    const rows = state.cookLog.map((e) =>
      cookEventToRow({ ...e, id: crypto.randomUUID(), planId: null }, householdId)
    );
    const { error } = await client.from("cook_log").insert(rows);
    if (error) throw error;
  }

  // Item locations: replace.
  const { error: delLoc } = await client.from("item_locations").delete().eq("household_id", householdId);
  if (delLoc) throw delLoc;
  if (state.itemLocations.length) {
    const rows = state.itemLocations.map((l) => itemLocationToRow(l, householdId));
    const { error } = await client.from("item_locations").insert(rows);
    if (error) throw error;
  }
  return planId;
}
