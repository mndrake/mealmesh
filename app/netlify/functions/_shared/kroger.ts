// Pure, environment-neutral Kroger OAuth/API helpers. No Netlify/Supabase deps here so
// this is unit-testable. The function handlers read env and pass values in.

/** Kroger API base. Production: api.kroger.com; Certification/sandbox: api-ce.kroger.com. */
export function apiBase(env: Record<string, string | undefined>): string {
  return env.KROGER_API_BASE || "https://api.kroger.com";
}

/** HTTP Basic auth header value for the token endpoint: base64(client_id:client_secret). */
export function basicAuthHeader(clientId: string, clientSecret: string): string {
  return "Basic " + btoa(`${clientId}:${clientSecret}`);
}

/** The authorize URL the browser is sent to so the user can grant cart access. */
export function authorizeUrl(opts: {
  base: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
}): string {
  const scope = (opts.scopes ?? ["cart.basic:write"]).join(" ");
  const q = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope,
    state: opts.state,
  });
  return `${opts.base}/v1/connect/oauth2/authorize?${q.toString()}`;
}

/** Form body to exchange an authorization code for tokens. */
export function authCodeTokenBody(code: string, redirectUri: string): string {
  return new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  }).toString();
}

/** Form body to refresh the user token. */
export function refreshTokenBody(refreshToken: string): string {
  return new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }).toString();
}

/** Form body for the client-credentials grant (Locations/Products). */
export function clientCredentialsBody(scope = "product.compact"): string {
  return new URLSearchParams({ grant_type: "client_credentials", scope }).toString();
}

/** Absolute ms expiry, with a safety skew so we refresh slightly early. */
export function computeExpiresAt(nowMs: number, expiresInSec: number, skewSec = 60): number {
  return nowMs + Math.max(0, expiresInSec - skewSec) * 1000;
}

/** True when the token is at/over its (skew-adjusted) expiry and should be refreshed. */
export function needsRefresh(expiresAtMs: number | null | undefined, nowMs: number): boolean {
  return expiresAtMs == null || nowMs >= expiresAtMs;
}

// ---- Locations / Products: query building + response shaping (pure) ----

export interface KrogerStore {
  locationId: string;
  name: string;
  address: string;
}

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
  quantity: number; // integer packages to buy; default 1
  include: boolean;
}

export function locationsQuery(zip: string, radiusMiles = 15, limit = 10): string {
  return new URLSearchParams({
    "filter.zipCode.near": zip,
    "filter.radiusInMiles": String(radiusMiles),
    "filter.chain": "Marianos",
    "filter.limit": String(limit),
  }).toString();
}

export function productsQuery(term: string, locationId: string, limit = 5): string {
  return new URLSearchParams({
    "filter.term": term,
    "filter.locationId": locationId,
    "filter.limit": String(limit),
  }).toString();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function toStores(resp: any): KrogerStore[] {
  return (resp?.data ?? []).map((l: any) => ({
    locationId: String(l.locationId ?? ""),
    name: l.name || l.chain || "Mariano's",
    address: [l.address?.addressLine1, l.address?.city, l.address?.state]
      .filter(Boolean)
      .join(", "),
  }));
}

function toMatch(p: any): ProductMatch | null {
  if (!p?.upc) return null;
  const item = p.items?.[0];
  const price = item?.price?.promo || item?.price?.regular || null;
  const f = item?.fulfillment ?? {};
  return {
    upc: String(p.upc),
    productId: String(p.productId ?? p.upc),
    description: p.description ?? "",
    price: typeof price === "number" ? price : null,
    available: Boolean(f.instore || f.curbside || f.delivery || f.shiptohome),
  };
}

/** Map a Products search response to a review row (top match + alternates). */
export function toReviewRow(resp: any, listName: string, displayQty: string): ReviewRow {
  const products = (resp?.data ?? []).map(toMatch).filter(Boolean) as ProductMatch[];
  const [matched, ...alternates] = products;
  return {
    listName,
    displayQty,
    matched: matched ?? null,
    alternates,
    quantity: 1,
    include: Boolean(matched),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
