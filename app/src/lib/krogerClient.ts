// Browser-side client for the Kroger broker functions. Every call carries the user's
// Supabase session JWT so the function can authorize + resolve the household. No Kroger
// tokens ever live here — those stay server-side.
import { supabase } from "./supabase";

export interface ProductMatch {
  upc: string;
  productId: string;
  description: string;
  price: number | null;
  available: boolean;
  aisle: string | null; // e.g. "Aisle 35" (often absent)
  aisleNumber: number | null; // 35 — for store-walk ordering
  bay: string | null; // bay within the aisle (often absent)
  shelf: string | null; // shelf number (often absent)
  side: string | null; // aisle side e.g. "L"/"R" (often absent)
  department: string | null; // e.g. "Produce"
  image: string | null; // small product image URL (often absent)
}
export interface ReviewRow {
  listName: string;
  displayQty: string;
  matched: ProductMatch | null;
  alternates: ProductMatch[];
  quantity: number;
  include: boolean;
}
export interface KrogerStore {
  locationId: string;
  name: string;
  address: string;
}
export interface SentItem {
  upc: string;
  name: string;
  quantity: number;
  sentAt: number;
}
export interface KrogerStatus {
  connected: boolean;
  storeName: string | null;
  modality: string;
  sentItems: SentItem[];
}

async function authHeaders(): Promise<Record<string, string>> {
  const res = await supabase?.auth.getSession();
  const token = res?.data.session?.access_token;
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function call<T>(path: string, init?: RequestInit, timeoutMs = 30000): Promise<T> {
  // Abort a hung request so the UI surfaces an error instead of spinning forever.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`/api/kroger/${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { ...(await authHeaders()), ...(init?.headers ?? {}) },
    });
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error("Request timed out — please try again.", { cause: e });
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Non-JSON body = the function crashed/returned an error page; surface it cleanly.
    throw new Error(`Server error (${res.status})${text ? `: ${text.slice(0, 140)}` : ""}`);
  }
  if (!res.ok) {
    const extra = [body.status, body.detail].filter(Boolean).join(" ");
    throw new Error(`${String(body.error ?? `HTTP ${res.status}`)}${extra ? ` — ${extra}` : ""}`);
  }
  return body as T;
}

export const krogerClient = {
  status: () => call<KrogerStatus>("status"),
  authUrl: () => call<{ url: string }>("auth-url"),
  locations: (zip: string) => call<{ stores: KrogerStore[] }>(`locations?zip=${encodeURIComponent(zip)}`),
  saveLocation: (locationId: string, storeName: string) =>
    call<{ ok: boolean }>("location", { method: "POST", body: JSON.stringify({ locationId, storeName }) }),
  // force=true bypasses the server cache (used by manual search / refresh). `section` (the
  // list's grocery aisle) lets the server prefer same-section products (shallots→Produce).
  match: (items: { name: string; displayQty: string; section?: string }[], force = false) =>
    call<{ rows: ReviewRow[] }>("match", { method: "POST", body: JSON.stringify({ items, force }) }),
  // AI advisor: re-pick the best product for items whose match looks wrong (Claude chooses
  // among candidates / suggests a better search term). Returns corrected review rows.
  advise: (items: { name: string; displayQty: string; section?: string }[]) =>
    call<{ rows: ReviewRow[]; fixed: number }>("advise", { method: "POST", body: JSON.stringify({ items }) }),
  cart: (items: { upc: string; quantity: number }[], modality: string) =>
    call<{ ok: boolean; added: number; failed: { upc: string; status: number }[] }>("cart", {
      method: "POST",
      body: JSON.stringify({ items, modality }),
    }),
  // Record what was added to the cart so re-sends can flag duplicates/removals.
  recordSent: (items: { upc: string; name: string; quantity: number }[]) =>
    call<{ ok: boolean; sentItems: SentItem[] }>("sent", { method: "POST", body: JSON.stringify({ items }) }),
  // Reset the send-history after the user checks out / empties their Mariano's cart.
  clearSent: () =>
    call<{ ok: boolean; sentItems: SentItem[] }>("sent", { method: "POST", body: JSON.stringify({ clear: true }) }),
  // Remember a better search term for an item (used by future matches); empty term clears it.
  saveAlias: (itemName: string, searchTerm: string) =>
    call<{ ok: boolean }>("alias", { method: "POST", body: JSON.stringify({ itemName, searchTerm }) }),
};
