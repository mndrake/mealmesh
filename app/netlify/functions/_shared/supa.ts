// Supabase access for the Kroger functions. The service-role client bypasses RLS and is
// the ONLY thing that touches kroger_connection / kroger_oauth_state — tokens never reach
// the browser. JWT verification uses an anon client to validate the caller's session.
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { SentItem } from "./kroger";
import { importRateDecision } from "./recipe-import";

// supabase-js eagerly constructs a Realtime client whose constructor resolves a WebSocket
// implementation. Netlify's Node 20 functions have no global WebSocket, so createClient
// throws ("Node.js 20 detected without native WebSocket support"). These functions never
// open a realtime channel, so a stub constructor satisfies the resolution and is never
// instantiated. (Removable once the functions runtime is Node 22+.)
const g = globalThis as { WebSocket?: unknown };
if (typeof g.WebSocket === "undefined") {
  g.WebSocket = class StubWebSocket {};
}

// The URL + anon key are the same public values the SPA uses; fall back to the VITE_
// vars so they don't have to be duplicated under un-prefixed names in Netlify. The
// service_role key is a real secret and has no fallback.
const URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)!;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Service-role client (bypasses RLS). Server-side only — never expose this key. */
export function service(): SupabaseClient {
  return createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Validate the caller's Supabase session from the Authorization: Bearer header. */
export async function getUser(req: Request): Promise<User | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const anon = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
}

/** The household the user belongs to (single-household family app). */
export async function householdIdFor(userId: string): Promise<string | null> {
  const { data } = await service()
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return (data?.household_id as string | undefined) ?? null;
}

// ---- OAuth CSRF state ----
export async function putState(state: string, householdId: string, userId: string): Promise<void> {
  const { error } = await service()
    .from("kroger_oauth_state")
    .insert({ state, household_id: householdId, created_by: userId });
  if (error) throw error;
}

/** Look up + delete a one-time state; returns the household + user that initiated it. */
export async function consumeState(
  state: string
): Promise<{ householdId: string; createdBy: string | null } | null> {
  const db = service();
  const { data } = await db
    .from("kroger_oauth_state")
    .select("household_id,created_by")
    .eq("state", state)
    .maybeSingle();
  await db.from("kroger_oauth_state").delete().eq("state", state);
  if (!data?.household_id) return null;
  return { householdId: data.household_id as string, createdBy: (data.created_by as string) ?? null };
}

// ---- Connection (tokens + store) ----
export interface KrogerConnection {
  location_id: string | null;
  store_name: string | null;
  modality: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  sent_items: SentItem[] | null;
}

export async function getConnection(householdId: string): Promise<KrogerConnection | null> {
  const db = service();
  const base = "location_id,store_name,modality,access_token,refresh_token,expires_at";
  const q = (cols: string) =>
    db.from("kroger_connection").select(cols).eq("household_id", householdId).maybeSingle();
  let { data, error } = await q(`${base},sent_items`);
  if (error) {
    // sent_items may not exist yet (migration 0004 not applied) — degrade to no history
    // rather than breaking the connection-status check.
    ({ data } = await q(base));
  }
  return (data as KrogerConnection | null) ?? null;
}

/** Replace the household's Kroger send-history (what MealMesh added to the cart). */
export async function setSentItems(householdId: string, items: SentItem[]): Promise<void> {
  const { error } = await service()
    .from("kroger_connection")
    .update({ sent_items: items })
    .eq("household_id", householdId);
  if (error) throw error;
}

export async function saveLocation(
  householdId: string,
  locationId: string,
  storeName: string | null
): Promise<void> {
  const { error } = await service()
    .from("kroger_connection")
    .upsert(
      { household_id: householdId, location_id: locationId, store_name: storeName },
      { onConflict: "household_id" }
    );
  if (error) throw error;
}

export async function setModality(householdId: string, modality: string): Promise<void> {
  await service()
    .from("kroger_connection")
    .update({ modality })
    .eq("household_id", householdId);
}

export async function saveTokens(
  householdId: string,
  tokens: { access_token: string; refresh_token: string; expires_at: string },
  connectedBy: string | null
): Promise<void> {
  const { error } = await service()
    .from("kroger_connection")
    .upsert({ household_id: householdId, ...tokens, connected_by: connectedBy }, { onConflict: "household_id" });
  if (error) throw error;
}

// ---- Item search aliases (override the term used to match an item) ----
/** Map of item_name -> search_term for the household. */
export async function getAliases(householdId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  // Tolerate the table not existing yet (migration 0008 not applied) — aliases are an
  // enhancement; a missing table must never break matching.
  const { data, error } = await service()
    .from("item_aliases")
    .select("item_name,search_term")
    .eq("household_id", householdId);
  if (error) return map;
  for (const r of (data ?? []) as { item_name: string; search_term: string }[]) {
    if (r.item_name && r.search_term) map.set(r.item_name, r.search_term);
  }
  return map;
}

export async function saveAlias(
  householdId: string,
  itemName: string,
  searchTerm: string,
  userId: string | null
): Promise<void> {
  const { error } = await service()
    .from("item_aliases")
    .upsert(
      { household_id: householdId, item_name: itemName, search_term: searchTerm, updated_by: userId },
      { onConflict: "household_id,item_name" }
    );
  if (error) throw error;
}

// ---- Kroger product-match cache (limit API calls; refresh only when stale) ----
export interface ProductCacheEntry {
  locationId: string;
  data: unknown; // { matched, alternates }
  fetchedAtMs: number;
}

/** item_name -> cached match for the household. Tolerates a missing table (returns empty). */
export async function getProductCache(householdId: string): Promise<Map<string, ProductCacheEntry>> {
  const map = new Map<string, ProductCacheEntry>();
  const { data, error } = await service()
    .from("kroger_product_cache")
    .select("item_name,location_id,data,fetched_at")
    .eq("household_id", householdId);
  if (error) return map;
  for (const r of (data ?? []) as { item_name: string; location_id: string; data: unknown; fetched_at: string }[]) {
    map.set(r.item_name, { locationId: r.location_id, data: r.data, fetchedAtMs: Date.parse(r.fetched_at) });
  }
  return map;
}

export async function upsertProductCache(
  householdId: string,
  entries: { itemName: string; locationId: string; data: unknown }[]
): Promise<void> {
  if (!entries.length) return;
  const nowIso = new Date().toISOString();
  const rows = entries.map((e) => ({
    household_id: householdId,
    item_name: e.itemName,
    location_id: e.locationId,
    data: e.data,
    fetched_at: nowIso,
  }));
  await service().from("kroger_product_cache").upsert(rows, { onConflict: "household_id,item_name" });
}

/** Drop a cached match (e.g. after an alias changes the search term for an item). */
export async function clearProductCacheItem(householdId: string, itemName: string): Promise<void> {
  await service().from("kroger_product_cache").delete().eq("household_id", householdId).eq("item_name", itemName);
}

// ---- Imported recipe images (re-hosted in Supabase Storage so the CSP stays tight) ----

/** Upload a recipe image to the public `recipe-images` bucket and return its public URL.
 *  Best-effort: returns null on any failure (the import never fails over a missing image). */
export async function uploadRecipeImage(
  householdId: string,
  recipeId: string,
  bytes: Uint8Array,
  contentType: string,
  ext: string
): Promise<string | null> {
  try {
    const db = service();
    const path = `${householdId}/${recipeId}.${ext}`;
    const { error } = await db.storage
      .from("recipe-images")
      .upload(path, bytes, { contentType, upsert: true });
    if (error) return null;
    return db.storage.from("recipe-images").getPublicUrl(path).data.publicUrl ?? null;
  } catch {
    return null;
  }
}

// ---- Recipe-import rate limiting (per household; durable across function instances) ----

/** Check the household's import quota and, when allowed, record this attempt. Durable
 *  (Supabase-backed) so it holds across stateless function invocations. Tolerates the
 *  table not existing yet (migration 0011 not applied) by degrading open — the endpoint
 *  is still auth-gated. Returns the decision; on block, `retryAfterSec` is the wait. */
export async function checkImportRateLimit(
  householdId: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const db = service();
  const now = Date.now();
  const cutoff = new Date(now - windowMs).toISOString();

  const { data, error } = await db
    .from("recipe_import_log")
    .select("created_at")
    .eq("household_id", householdId)
    .gte("created_at", cutoff);
  if (error) return { allowed: true, retryAfterSec: 0 }; // table missing → degrade open

  const recentMs = (data ?? []).map((r) => Date.parse((r as { created_at: string }).created_at));
  const decision = importRateDecision(recentMs, now, limit, windowMs);
  if (!decision.allowed) return decision;

  // Record this attempt, then opportunistically prune aged-out rows (best-effort).
  await db.from("recipe_import_log").insert({ household_id: householdId });
  void db.from("recipe_import_log").delete().eq("household_id", householdId).lt("created_at", cutoff);
  return decision;
}
