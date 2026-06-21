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
  aisle: string | null; // e.g. "Aisle 35" (often absent — coverage is partial)
  aisleNumber: number | null; // 35 — for store-walk ordering
  department: string | null; // e.g. "Produce" (from categories[0])
}

export interface ReviewRow {
  listName: string;
  displayQty: string;
  matched: ProductMatch | null;
  alternates: ProductMatch[];
  quantity: number; // integer packages to buy; default 1
  include: boolean;
}

/** One product MealMesh has added to the Kroger cart (its own send-history). */
export interface SentItem {
  upc: string;
  name: string; // the user's shopping-list name, for a readable "remove these" hint
  quantity: number;
  sentAt: number; // ms epoch of the most recent send
}

/** Merge newly-sent items into the existing send-history, keyed by UPC. Quantities sum
 *  (the real cart accumulates on each add) and the latest name + sentAt win. */
export function mergeSentItems(existing: SentItem[], added: SentItem[]): SentItem[] {
  const byUpc = new Map<string, SentItem>();
  for (const it of existing) if (it?.upc) byUpc.set(it.upc, { ...it });
  for (const it of added) {
    if (!it?.upc) continue;
    const prev = byUpc.get(it.upc);
    byUpc.set(it.upc, {
      upc: it.upc,
      name: it.name || prev?.name || "",
      quantity: (prev?.quantity ?? 0) + (it.quantity ?? 0),
      sentAt: it.sentAt ?? prev?.sentAt ?? Date.now(),
    });
  }
  return [...byUpc.values()];
}

/** Items previously sent to the cart whose UPC isn't on the current list — the user should
 *  remove these in Mariano's to match the plan (the API can't remove them for us). */
export function itemsToRemove(sent: SentItem[], currentUpcs: string[]): SentItem[] {
  const current = new Set(currentUpcs);
  return sent.filter((s) => s?.upc && !current.has(s.upc));
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
  const al = p.aisleLocations?.[0];
  const aisle = al?.description ? String(al.description) : al?.number ? `Aisle ${al.number}` : null;
  const aisleNum = al?.number != null && al.number !== "" ? Number(al.number) : NaN;
  const department = Array.isArray(p.categories) && p.categories.length ? String(p.categories[0]) : null;
  return {
    upc: String(p.upc),
    productId: String(p.productId ?? p.upc),
    description: p.description ?? "",
    price: typeof price === "number" ? price : null,
    available: Boolean(f.instore || f.curbside || f.delivery || f.shiptohome),
    aisle,
    aisleNumber: Number.isFinite(aisleNum) ? aisleNum : null,
    department,
  };
}

/** Map a Products search response to a review row (top match + alternates). */
export function toReviewRow(resp: any, listName: string, displayQty: string): ReviewRow {
  const products = (resp?.data ?? []).map(toMatch).filter(Boolean) as ProductMatch[];
  // Default to the first *available* product so we don't pre-select something that can't be
  // fulfilled when an in-stock alternate exists; fall back to the top result if none are.
  const found = products.findIndex((p) => p.available);
  const i = found >= 0 ? found : 0;
  const matched = products[i] ?? null;
  const alternates = products.filter((_, idx) => idx !== i);
  return {
    listName,
    displayQty,
    matched,
    alternates,
    quantity: 1,
    include: Boolean(matched),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
