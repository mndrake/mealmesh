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
  bay: string | null; // bay number within the aisle (often absent)
  shelf: string | null; // shelf number (often absent)
  side: string | null; // aisle side, e.g. "L"/"R" (often absent)
  department: string | null; // e.g. "Produce" (from categories[0])
  image: string | null; // small product image URL (often absent)
}

/** Map a Kroger department to one of our shopping sections, conservatively (mirror of
 *  src/lib/krogerSections.ts — kept here so the function has no app-src dependency). Only
 *  confident mappings; unknown departments return null and never force a re-rank. */
export function krogerDepartmentToSection(department: string | null | undefined): string | null {
  if (!department) return null;
  const d = department.toLowerCase();
  if (d.includes("produce")) return "Produce";
  if (d.includes("seafood") || d.includes("meat") || d.includes("poultry")) return "Meat & Poultry";
  if (d.includes("dairy") || d.includes("egg")) return "Dairy & Eggs";
  if (d.includes("frozen")) return "Frozen";
  if (d.includes("bakery") || d.includes("bread")) return "Bakery";
  return null;
}

/** Rank a candidate for the "best match": available products win, and a product whose Kroger
 *  department contradicts the expected aisle (e.g. shallots matched to Deli when the list says
 *  Produce) is penalized so a same-section alternate is preferred. */
export function scoreMatch(p: ProductMatch, expectedSection?: string | null): number {
  let s = p.available ? 100 : 0;
  const dept = krogerDepartmentToSection(p.department);
  if (expectedSection && dept) s += dept === expectedSection ? 40 : -60;
  return s;
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

/** Default product-match cache lifetime (7 days). Prices drift but the goal is to avoid
 *  re-hitting the Kroger API on every open; the user can force a refresh. */
export const PRODUCT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A cached product match is usable when it's for the current store and within the TTL. */
export function isCacheFresh(
  cached: { locationId: string; fetchedAtMs: number } | null | undefined,
  currentLocationId: string,
  nowMs: number,
  ttlMs = PRODUCT_CACHE_TTL_MS
): boolean {
  if (!cached) return false;
  return cached.locationId === currentLocationId && nowMs - cached.fetchedAtMs < ttlMs;
}

export function locationsQuery(zip: string, radiusMiles = 15, limit = 10): string {
  return new URLSearchParams({
    "filter.zipCode.near": zip,
    "filter.radiusInMiles": String(radiusMiles),
    "filter.chain": "Marianos",
    "filter.limit": String(limit),
  }).toString();
}

export function productsQuery(term: string, locationId: string, limit = 12, fulfillment = "ais,csp,dth"): string {
  return new URLSearchParams({
    "filter.term": term,
    "filter.locationId": locationId,
    // Only return products fulfillable at this store (in-store / curbside / delivery), so the
    // top results aren't unavailable variants. ais=in store, csp=curbside, dth=delivery.
    "filter.fulfillment": fulfillment,
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

/** Pick a small product image URL (front perspective preferred). */
function pickImage(images: any): string | null {
  if (!Array.isArray(images) || !images.length) return null;
  const front = images.find((im) => im?.perspective === "front") ?? images[0];
  const sizes = Array.isArray(front?.sizes) ? front.sizes : [];
  for (const want of ["thumbnail", "small", "medium", "large"]) {
    const m = sizes.find((z: any) => z?.size === want);
    if (m?.url) return String(m.url);
  }
  return sizes[0]?.url ? String(sizes[0].url) : null;
}

/** Availability for the matched store, from Kroger's fulfillment flags. Strict: only true
 *  when a fulfillment option is reported. The search is filtered to fulfillable products
 *  (filter.fulfillment) so matches are available without us having to assume. */
function availableOf(item: any): boolean {
  const f = item?.fulfillment;
  if (!f || typeof f !== "object") return false;
  return Boolean(f.instore || f.curbside || f.delivery || f.shiptohome);
}

function toMatch(p: any): ProductMatch | null {
  if (!p?.upc) return null;
  const item = p.items?.[0];
  const price = item?.price?.promo || item?.price?.regular || null;
  const al = p.aisleLocations?.[0];
  const aisle = al?.description ? String(al.description) : al?.number ? `Aisle ${al.number}` : null;
  const aisleNum = al?.number != null && al.number !== "" ? Number(al.number) : NaN;
  const str = (v: unknown) => (v != null && v !== "" ? String(v) : null);
  const department = Array.isArray(p.categories) && p.categories.length ? String(p.categories[0]) : null;
  return {
    upc: String(p.upc),
    productId: String(p.productId ?? p.upc),
    description: p.description ?? "",
    price: typeof price === "number" ? price : null,
    available: availableOf(item),
    aisle,
    aisleNumber: Number.isFinite(aisleNum) ? aisleNum : null,
    bay: str(al?.bayNumber),
    shelf: str(al?.shelfNumber),
    side: str(al?.side),
    department,
    image: pickImage(p.images),
  };
}

/** Map a Products search response to a review row (top match + alternates). Picks the
 *  highest-scoring candidate (available + same expected section) so wrong-department matches
 *  like shallots→Deli are avoided when a same-section alternate exists. Ties keep Kroger's
 *  order (relevance). */
export function toReviewRow(resp: any, listName: string, displayQty: string, expectedSection?: string | null): ReviewRow {
  const products = (resp?.data ?? []).map(toMatch).filter(Boolean) as ProductMatch[];
  let best = -1;
  let bestScore = -Infinity;
  products.forEach((p, idx) => {
    const sc = scoreMatch(p, expectedSection);
    if (sc > bestScore) {
      bestScore = sc;
      best = idx;
    }
  });
  const matched = best >= 0 ? products[best] : null;
  const alternates = products.filter((_, idx) => idx !== best);
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
