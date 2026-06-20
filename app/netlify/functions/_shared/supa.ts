// Supabase access for the Kroger functions. The service-role client bypasses RLS and is
// the ONLY thing that touches kroger_connection / kroger_oauth_state — tokens never reach
// the browser. JWT verification uses an anon client to validate the caller's session.
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

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
}

export async function getConnection(householdId: string): Promise<KrogerConnection | null> {
  const { data } = await service()
    .from("kroger_connection")
    .select("location_id,store_name,modality,access_token,refresh_token,expires_at")
    .eq("household_id", householdId)
    .maybeSingle();
  return (data as KrogerConnection | null) ?? null;
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
