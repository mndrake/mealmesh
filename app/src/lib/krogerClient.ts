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
export interface KrogerStatus {
  connected: boolean;
  storeName: string | null;
  modality: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const res = await supabase?.auth.getSession();
  const token = res?.data.session?.access_token;
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/kroger/${path}`, {
    ...init,
    headers: { ...(await authHeaders()), ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body as T;
}

export const krogerClient = {
  status: () => call<KrogerStatus>("status"),
  authUrl: () => call<{ url: string }>("auth-url"),
  locations: (zip: string) => call<{ stores: KrogerStore[] }>(`locations?zip=${encodeURIComponent(zip)}`),
  saveLocation: (locationId: string, storeName: string) =>
    call<{ ok: boolean }>("location", { method: "POST", body: JSON.stringify({ locationId, storeName }) }),
  match: (items: { name: string; displayQty: string }[]) =>
    call<{ rows: ReviewRow[] }>("match", { method: "POST", body: JSON.stringify({ items }) }),
  cart: (items: { upc: string; quantity: number }[], modality: string) =>
    call<{ ok: boolean; added: number }>("cart", { method: "POST", body: JSON.stringify({ items, modality }) }),
};
