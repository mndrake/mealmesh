// Impure Kroger network calls (kept out of kroger.ts so that stays pure/testable).
import {
  apiBase,
  basicAuthHeader,
  clientCredentialsBody,
  locationsQuery,
  productsQuery,
  refreshTokenBody,
} from "./kroger";

type Env = Record<string, string | undefined>;

/** Refresh the user (authorization-code) token using the stored refresh token. */
export async function refreshUserToken(
  env: Env,
  refreshToken: string
): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch(`${apiBase(env)}/v1/connect/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(env.KROGER_CLIENT_ID!, env.KROGER_CLIENT_SECRET!),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: refreshTokenBody(refreshToken),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>;
}

/** PUT items into the user's Kroger cart. Returns the raw Response (204 = success). */
export async function addToCart(
  env: Env,
  accessToken: string,
  items: { upc: string; quantity: number }[],
  modality: string
): Promise<Response> {
  return fetch(`${apiBase(env)}/v1/cart/add`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ items: items.map((i) => ({ upc: i.upc, quantity: i.quantity, modality })) }),
  });
}

/** Get a client-credentials token for Locations/Products (no user involved). */
export async function clientCredToken(env: Env): Promise<string> {
  const res = await fetch(`${apiBase(env)}/v1/connect/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(env.KROGER_CLIENT_ID!, env.KROGER_CLIENT_SECRET!),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: clientCredentialsBody("product.compact"),
  });
  if (!res.ok) throw new Error(`client-cred token failed: ${res.status}`);
  const tok = (await res.json()) as { access_token: string };
  return tok.access_token;
}

export async function getLocations(env: Env, token: string, zip: string): Promise<unknown> {
  const res = await fetch(`${apiBase(env)}/v1/locations?${locationsQuery(zip)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`locations failed: ${res.status}`);
  return res.json();
}

/** Search products for one term. A failed search is treated as "no match" rather than
 *  failing the whole batch. The default search is filtered to online-fulfillable products;
 *  if that returns too few (e.g. in-store-only produce not flagged for delivery/pickup at
 *  this store), retry without the fulfillment filter so real items still surface — availability
 *  is tracked per-product downstream, so unavailable extras don't hurt. */
export async function searchProducts(
  env: Env,
  token: string,
  term: string,
  locationId: string
): Promise<unknown> {
  const fetchq = async (q: string): Promise<{ data?: unknown[] }> => {
    const res = await fetch(`${apiBase(env)}/v1/products?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { data: [] };
    return (await res.json()) as { data?: unknown[] };
  };
  const strict = await fetchq(productsQuery(term, locationId));
  if ((strict.data?.length ?? 0) >= 4) return strict;
  const broad = await fetchq(productsQuery(term, locationId, 12, "")); // no fulfillment filter
  return (broad.data?.length ?? 0) > (strict.data?.length ?? 0) ? broad : strict;
}
