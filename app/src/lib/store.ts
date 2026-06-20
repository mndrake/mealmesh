// Tiny localStorage-backed store with a useSyncExternalStore hook.
// Single-user, no auth — all state lives in the browser and is exportable.
import { useSyncExternalStore } from "react";
import { DAYS } from "./planner";
import type { Plan, PlanDay } from "./types";

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
}

export function emptyPlan(): Plan {
  return DAYS.map(
    (day): PlanDay => ({
      day,
      breakfast: null,
      lunch: null,
      dinner: null,
      snack: null,
    })
  );
}

function defaultState(): AppState {
  return { activePlan: emptyPlan(), savedPlans: [], favorites: [], checked: [], locked: [] };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

let state: AppState = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function set(next: Partial<AppState>) {
  state = { ...state, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode — keep working in-memory */
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

// ---- actions ----

export const actions = {
  setActivePlan(plan: Plan) {
    set({ activePlan: plan });
  },

  setSlot(dayIndex: number, slot: keyof Omit<PlanDay, "day">, value: PlanDay[typeof slot]) {
    const activePlan = state.activePlan.map((d, i) =>
      i === dayIndex ? { ...d, [slot]: value } : d
    );
    set({ activePlan });
  },

  clearPlan() {
    set({ activePlan: emptyPlan(), locked: [] });
  },

  toggleLock(key: string) {
    const locked = state.locked.includes(key)
      ? state.locked.filter((k) => k !== key)
      : [...state.locked, key];
    set({ locked });
  },

  unlock(key: string) {
    if (state.locked.includes(key)) set({ locked: state.locked.filter((k) => k !== key) });
  },

  clearLocks() {
    set({ locked: [] });
  },

  toggleFavorite(id: string) {
    const favorites = state.favorites.includes(id)
      ? state.favorites.filter((f) => f !== id)
      : [...state.favorites, id];
    set({ favorites });
  },

  toggleChecked(name: string) {
    const checked = state.checked.includes(name)
      ? state.checked.filter((c) => c !== name)
      : [...state.checked, name];
    set({ checked });
  },

  clearChecked() {
    set({ checked: [] });
  },

  savePlanAs(name: string) {
    const sp: SavedPlan = {
      id: `${name}-${state.savedPlans.length + 1}-${Math.floor(performance.now())}`,
      name,
      createdAt: Date.now(),
      plan: state.activePlan,
    };
    set({ savedPlans: [...state.savedPlans, sp] });
    return sp.id;
  },

  loadPlan(id: string) {
    const sp = state.savedPlans.find((p) => p.id === id);
    if (sp) set({ activePlan: sp.plan, locked: [] });
  },

  deletePlan(id: string) {
    set({ savedPlans: state.savedPlans.filter((p) => p.id !== id) });
  },

  importState(next: AppState) {
    set({
      activePlan: next.activePlan ?? emptyPlan(),
      savedPlans: next.savedPlans ?? [],
      favorites: next.favorites ?? [],
      checked: next.checked ?? [],
      locked: next.locked ?? [],
    });
  },
};
