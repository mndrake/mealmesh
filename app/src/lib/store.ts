// State store. Public surface (useStore, getState, actions, emptyPlan) is unchanged from
// the original localStorage-only version — components depend on it. Internally it runs in
// one of two modes:
//   • local  — no Supabase / signed out: localStorage singleton, exactly as before.
//   • cloud  — connect(client, householdId): each action does an optimistic in-memory
//              update (instant) then writes through to Supabase and reconciles; Realtime
//              applies other devices' changes; localStorage stays a fast/offline cache.
// The auth layer calls connect()/disconnect(); see auth-provider.tsx.
import { useSyncExternalStore } from "react";
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { DAYS } from "./planner";
import type { Plan, PlanDay, CookEvent, ItemLocation } from "./types";
import {
  hydrate,
  writeActivePlan,
  insertSavedPlan,
  deleteSavedPlan,
  renameSavedPlan,
  updateSavedPlan,
  setFavorite,
  setCheckoff,
  clearCheckoffs,
  insertCookEvent,
  deleteCookEvent as cloudDeleteCookEvent,
  updateCookEvent as cloudUpdateCookEvent,
  upsertItemLocations,
  pushFullState,
} from "./cloudStore";

const KEY = "mealmesh.state.v1";

export interface SavedPlan {
  id: string;
  name: string;
  createdAt: number;
  plan: Plan;
}

export interface AppState {
  activePlan: Plan;
  savedPlans: SavedPlan[];
  favorites: string[]; // recipe ids
  checked: string[]; // shopping list item names checked off
  locked: string[]; // "<dayIndex>:<slot>" keys pinned against regenerate
  cookLog: CookEvent[]; // "I made this" history (newest-first)
  itemLocations: ItemLocation[]; // store aisle/department cache (by item name)
  // ---- ephemeral (not persisted to localStorage) ----
  loading: boolean; // hydrating from the cloud
  syncError: boolean; // last cloud write failed to reconcile
  importAvailable: boolean; // local data can be imported into an empty household
}

export function emptyPlan(): Plan {
  return DAYS.map(
    (day): PlanDay => ({ day, breakfast: null, lunch: null, dinner: null, snack: null })
  );
}

const EPHEMERAL = { loading: false, syncError: false, importAvailable: false };

function defaultState(): AppState {
  return { activePlan: emptyPlan(), savedPlans: [], favorites: [], checked: [], locked: [], cookLog: [], itemLocations: [], ...EPHEMERAL };
}

// Durable subset that round-trips through localStorage (cache + offline view).
type Durable = Pick<AppState, "activePlan" | "savedPlans" | "favorites" | "checked" | "locked" | "cookLog" | "itemLocations">;
function durableOf(s: AppState): Durable {
  return {
    activePlan: s.activePlan,
    savedPlans: s.savedPlans,
    favorites: s.favorites,
    checked: s.checked,
    locked: s.locked,
    cookLog: s.cookLog,
    itemLocations: s.itemLocations,
  };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed, ...EPHEMERAL };
  } catch {
    return defaultState();
  }
}

function hasData(s: Durable): boolean {
  return (
    s.savedPlans.length > 0 ||
    s.favorites.length > 0 ||
    s.checked.length > 0 ||
    s.cookLog.length > 0 ||
    s.activePlan.some((d) => d.breakfast || d.lunch || d.dinner || d.snack)
  );
}

let state: AppState = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function set(next: Partial<AppState>) {
  state = { ...state, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(durableOf(state)));
  } catch {
    /* quota / private mode / SSR — keep working in-memory */
  }
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state)
  );
}

export function getState(): AppState {
  return state;
}

// ---------------------------------------------------------------------------
// Cloud orchestration
// ---------------------------------------------------------------------------
interface CloudCtx {
  client: SupabaseClient;
  householdId: string;
  userId?: string;
  activePlanId: string | null;
}
let cloud: CloudCtx | null = null;
let channel: RealtimeChannel | null = null;
let inFlight = 0; // outstanding own writes (echo guard)
let staleAfterWrites = false; // a remote change arrived mid-write; resync when writes drain
let syncScheduled = false;
let importPending = false; // suspend write-through until the one-time import is resolved
let pendingImport: { local: AppState; cloud: AppState } | null = null;

export function isCloud(): boolean {
  return cloud !== null;
}

/** Pull server truth back into the snapshot (UI "retry" after a sync error). */
export function retrySync() {
  if (cloud) {
    set({ syncError: false });
    scheduleSync();
  }
}

/** Run a cloud write with optimistic state already applied; reconcile on error. */
function push(fn: (ctx: CloudCtx) => Promise<string | void>) {
  if (!cloud || importPending) return;
  const ctx = cloud;
  inFlight++;
  Promise.resolve()
    .then(() => fn(ctx))
    .then((planId) => {
      if (typeof planId === "string") ctx.activePlanId = planId;
      if (state.syncError) set({ syncError: false });
    })
    .catch((err) => {
      console.warn("[store] cloud write failed:", err?.message ?? err);
      set({ syncError: true });
      scheduleSync(); // pull server truth back
    })
    .finally(() => {
      inFlight--;
      if (inFlight === 0 && staleAfterWrites) {
        staleAfterWrites = false;
        scheduleSync();
      }
    });
}

/** Coalesced re-hydrate from Supabase (server is source of truth on reconnect/remote change). */
function scheduleSync() {
  if (!cloud || syncScheduled) return;
  syncScheduled = true;
  setTimeout(async () => {
    syncScheduled = false;
    if (!cloud || importPending) return;
    try {
      const res = await hydrate(cloud.client, cloud.householdId, emptyPlan);
      cloud.activePlanId = res.activePlanId;
      set({ ...res.state, ...EPHEMERAL });
    } catch (e) {
      console.warn("[store] resync failed:", e);
    }
  }, 50);
}

function onRemoteChange() {
  if (inFlight > 0) staleAfterWrites = true; // our own write is settling; resync after
  else scheduleSync();
}

function subscribeRealtime() {
  if (!cloud) return;
  const h = cloud.householdId;
  channel = cloud.client
    .channel(`mealmesh-${h}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "plans", filter: `household_id=eq.${h}` }, onRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "favorites", filter: `household_id=eq.${h}` }, onRemoteChange)
    // checkoffs can't be filtered by household here; RLS already scopes events to ours.
    .on("postgres_changes", { event: "*", schema: "public", table: "shopping_checkoffs" }, onRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "cook_log", filter: `household_id=eq.${h}` }, onRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "item_locations", filter: `household_id=eq.${h}` }, onRemoteChange)
    .subscribe();
}

/** Enter cloud mode: hydrate, wire Realtime, and offer a one-time local import. */
export async function connect(client: SupabaseClient, householdId: string, userId?: string) {
  cloud = { client, householdId, userId, activePlanId: null };
  importPending = false;
  pendingImport = null;
  set({ loading: true });
  try {
    const res = await hydrate(client, householdId, emptyPlan);
    cloud.activePlanId = res.activePlanId;
    const local = durableOf(state);
    if (res.isEmpty && hasData(local)) {
      // keep showing local data; suspend write-through until the user decides
      importPending = true;
      pendingImport = { local: { ...state }, cloud: { ...defaultState(), ...res.state } };
      set({ loading: false, importAvailable: true });
    } else {
      set({ ...res.state, ...EPHEMERAL });
    }
    subscribeRealtime();
  } catch (e) {
    console.warn("[store] connect/hydrate failed:", e);
    set({ loading: false, syncError: true });
  }
}

/** Leave cloud mode (sign-out): tear down Realtime, fall back to the local cache. */
export async function disconnect() {
  if (channel && cloud) await cloud.client.removeChannel(channel);
  channel = null;
  cloud = null;
  importPending = false;
  pendingImport = null;
  inFlight = 0;
  staleAfterWrites = false;
  set({ ...load() });
}

/** Resolve the one-time import prompt. accept=true pushes local data up; false discards it. */
export async function resolveImport(accept: boolean) {
  const pi = pendingImport;
  pendingImport = null;
  set({ importAvailable: false });
  if (!cloud || !pi) {
    importPending = false;
    return;
  }
  if (!accept) {
    importPending = false;
    set({ ...pi.cloud, ...EPHEMERAL });
    return;
  }
  set({ loading: true });
  try {
    const planId = await pushFullState(cloud.client, cloud.householdId, cloud.activePlanId, pi.local);
    cloud.activePlanId = planId;
    importPending = false;
    const res = await hydrate(cloud.client, cloud.householdId, emptyPlan);
    cloud.activePlanId = res.activePlanId;
    set({ ...res.state, ...EPHEMERAL });
  } catch (e) {
    console.warn("[store] import failed:", e);
    importPending = false;
    set({ loading: false, syncError: true });
  }
}

// ---------------------------------------------------------------------------
// Actions — optimistic in-memory update (unchanged behavior) + cloud write-through
// ---------------------------------------------------------------------------
export const actions = {
  setActivePlan(plan: Plan) {
    set({ activePlan: plan });
    push((c) => writeActivePlan(c.client, { householdId: c.householdId, planId: c.activePlanId, activePlan: state.activePlan, locked: state.locked, userId: c.userId }));
  },

  setSlot(dayIndex: number, slot: keyof Omit<PlanDay, "day">, value: PlanDay[typeof slot]) {
    const activePlan = state.activePlan.map((d, i) => (i === dayIndex ? { ...d, [slot]: value } : d));
    set({ activePlan });
    push((c) => writeActivePlan(c.client, { householdId: c.householdId, planId: c.activePlanId, activePlan: state.activePlan, locked: state.locked, userId: c.userId }));
  },

  clearPlan() {
    set({ activePlan: emptyPlan(), locked: [], checked: [] });
    push(async (c) => {
      const planId = await writeActivePlan(c.client, { householdId: c.householdId, planId: c.activePlanId, activePlan: state.activePlan, locked: state.locked, userId: c.userId });
      await clearCheckoffs(c.client, planId);
      return planId;
    });
  },

  toggleLock(key: string) {
    const locked = state.locked.includes(key) ? state.locked.filter((k) => k !== key) : [...state.locked, key];
    set({ locked });
    push((c) => writeActivePlan(c.client, { householdId: c.householdId, planId: c.activePlanId, activePlan: state.activePlan, locked: state.locked, userId: c.userId }));
  },

  unlock(key: string) {
    if (!state.locked.includes(key)) return;
    set({ locked: state.locked.filter((k) => k !== key) });
    push((c) => writeActivePlan(c.client, { householdId: c.householdId, planId: c.activePlanId, activePlan: state.activePlan, locked: state.locked, userId: c.userId }));
  },

  clearLocks() {
    set({ locked: [] });
    push((c) => writeActivePlan(c.client, { householdId: c.householdId, planId: c.activePlanId, activePlan: state.activePlan, locked: state.locked, userId: c.userId }));
  },

  toggleFavorite(id: string) {
    const on = !state.favorites.includes(id);
    set({ favorites: on ? [...state.favorites, id].sort() : state.favorites.filter((f) => f !== id) });
    push((c) => setFavorite(c.client, c.householdId, id, on));
  },

  toggleChecked(name: string) {
    const on = !state.checked.includes(name);
    set({ checked: on ? [...state.checked, name] : state.checked.filter((x) => x !== name) });
    push(async (c) => {
      if (!c.activePlanId) {
        c.activePlanId = await writeActivePlan(c.client, { householdId: c.householdId, planId: null, activePlan: state.activePlan, locked: state.locked, userId: c.userId });
      }
      await setCheckoff(c.client, c.activePlanId, name, on);
    });
  },

  clearChecked() {
    set({ checked: [] });
    push(async (c) => {
      if (c.activePlanId) await clearCheckoffs(c.client, c.activePlanId);
    });
  },

  /** Record an "I made this" event (optimistic; newest-first). Returns the new id. */
  markCooked(entry: { recipeId: string; cookedOn: string; rating?: number | null; makeAgain?: boolean | null; notes?: string | null }) {
    const event: CookEvent = {
      id: crypto.randomUUID(),
      recipeId: entry.recipeId,
      cookedOn: entry.cookedOn,
      rating: entry.rating ?? null,
      makeAgain: entry.makeAgain ?? null,
      notes: entry.notes?.trim() ? entry.notes.trim() : null,
      planId: cloud?.activePlanId ?? null,
    };
    set({ cookLog: [event, ...state.cookLog] });
    push((c) => insertCookEvent(c.client, event, c.householdId, c.userId));
    return event.id;
  },

  deleteCookEvent(id: string) {
    set({ cookLog: state.cookLog.filter((e) => e.id !== id) });
    push((c) => cloudDeleteCookEvent(c.client, id));
  },

  /** Edit a recorded cook event (date / rating / thumbs / notes). */
  editCookEvent(
    id: string,
    patch: { cookedOn?: string; rating?: number | null; makeAgain?: boolean | null; notes?: string | null }
  ) {
    const clean = { ...patch };
    if (clean.notes !== undefined) clean.notes = clean.notes && clean.notes.trim() ? clean.notes.trim() : null;
    set({ cookLog: state.cookLog.map((e) => (e.id === id ? { ...e, ...clean } : e)) });
    push((c) => cloudUpdateCookEvent(c.client, id, clean));
  },

  /** Cache store locations for items (by name), e.g. from a Kroger match. Upserts by name. */
  saveItemLocations(entries: ItemLocation[]) {
    if (!entries.length) return;
    const byName = new Map(state.itemLocations.map((l) => [l.name, l]));
    for (const e of entries) byName.set(e.name, e);
    set({ itemLocations: [...byName.values()] });
    push((c) => upsertItemLocations(c.client, entries, c.householdId, c.userId));
  },

  savePlanAs(name: string) {
    const sp: SavedPlan = { id: crypto.randomUUID(), name, createdAt: Date.now(), plan: state.activePlan };
    set({ savedPlans: [...state.savedPlans, sp] });
    push((c) => insertSavedPlan(c.client, { id: sp.id, name: sp.name, plan: sp.plan }, c.householdId));
    return sp.id;
  },

  loadPlan(id: string) {
    const sp = state.savedPlans.find((p) => p.id === id);
    if (!sp) return;
    set({ activePlan: sp.plan, locked: [] });
    push((c) => writeActivePlan(c.client, { householdId: c.householdId, planId: c.activePlanId, activePlan: state.activePlan, locked: state.locked, userId: c.userId }));
  },

  deletePlan(id: string) {
    set({ savedPlans: state.savedPlans.filter((p) => p.id !== id) });
    push((c) => deleteSavedPlan(c.client, id));
  },

  renamePlan(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    set({ savedPlans: state.savedPlans.map((p) => (p.id === id ? { ...p, name: trimmed } : p)) });
    push((c) => renameSavedPlan(c.client, id, trimmed));
  },

  /** Overwrite an existing saved menu with the current active plan. */
  overwritePlan(id: string) {
    if (!state.savedPlans.some((p) => p.id === id)) return;
    const plan = state.activePlan;
    set({ savedPlans: state.savedPlans.map((p) => (p.id === id ? { ...p, plan, createdAt: Date.now() } : p)) });
    push((c) => updateSavedPlan(c.client, id, plan));
  },

  importState(next: Partial<AppState>) {
    set({
      activePlan: next.activePlan ?? emptyPlan(),
      savedPlans: next.savedPlans ?? [],
      favorites: next.favorites ?? [],
      checked: next.checked ?? [],
      locked: next.locked ?? [],
      cookLog: next.cookLog ?? [],
      itemLocations: next.itemLocations ?? [],
    });
    push(async (c) => {
      const planId = await pushFullState(c.client, c.householdId, c.activePlanId, state);
      return planId;
    });
  },
};
