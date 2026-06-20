import { describe, it, expect } from "vitest";
import {
  apiBase,
  basicAuthHeader,
  authorizeUrl,
  authCodeTokenBody,
  refreshTokenBody,
  computeExpiresAt,
  needsRefresh,
  locationsQuery,
  productsQuery,
  toStores,
  toReviewRow,
} from "./kroger";

describe("kroger pure helpers", () => {
  it("apiBase defaults to production, overridable via env", () => {
    expect(apiBase({})).toBe("https://api.kroger.com");
    expect(apiBase({ KROGER_API_BASE: "https://api-ce.kroger.com" })).toBe("https://api-ce.kroger.com");
  });

  it("basicAuthHeader base64-encodes id:secret", () => {
    expect(basicAuthHeader("id", "secret")).toBe("Basic " + btoa("id:secret"));
  });

  it("authorizeUrl includes the required OAuth params", () => {
    const url = authorizeUrl({
      base: "https://api.kroger.com",
      clientId: "cid",
      redirectUri: "https://app/api/kroger/callback",
      state: "xyz",
    });
    const u = new URL(url);
    expect(u.pathname).toBe("/v1/connect/oauth2/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app/api/kroger/callback");
    expect(u.searchParams.get("scope")).toBe("cart.basic:write");
    expect(u.searchParams.get("state")).toBe("xyz");
  });

  it("token bodies are correct form-encoded grants", () => {
    expect(authCodeTokenBody("c", "r")).toBe("grant_type=authorization_code&code=c&redirect_uri=r");
    expect(refreshTokenBody("t")).toBe("grant_type=refresh_token&refresh_token=t");
  });

  it("expiry math honors the skew and decides refresh", () => {
    const now = 1_000_000;
    const exp = computeExpiresAt(now, 1800, 60); // 1740s out
    expect(exp).toBe(now + 1740 * 1000);
    expect(needsRefresh(exp, now)).toBe(false);
    expect(needsRefresh(exp, exp)).toBe(true);
    expect(needsRefresh(exp, exp + 1)).toBe(true);
    expect(needsRefresh(null, now)).toBe(true);
  });

  it("builds Locations/Products queries filtered to Mariano's + the store", () => {
    const loc = new URLSearchParams(locationsQuery("60601"));
    expect(loc.get("filter.chain")).toBe("Marianos");
    expect(loc.get("filter.zipCode.near")).toBe("60601");
    const prod = new URLSearchParams(productsQuery("red onion", "01400943", 5));
    expect(prod.get("filter.term")).toBe("red onion");
    expect(prod.get("filter.locationId")).toBe("01400943");
    expect(prod.get("filter.limit")).toBe("5");
  });

  it("maps a Locations response to stores", () => {
    const stores = toStores({
      data: [{ locationId: "0140", name: "Mariano's Lakeview", chain: "MARIANOS", address: { addressLine1: "123 N Ave", city: "Chicago", state: "IL" } }],
    });
    expect(stores).toEqual([{ locationId: "0140", name: "Mariano's Lakeview", address: "123 N Ave, Chicago, IL" }]);
  });

  it("maps a Products response to a review row (top match + alternates, UPC carried)", () => {
    const row = toReviewRow(
      {
        data: [
          { upc: "0001", productId: "p1", description: "Red Onion", items: [{ price: { regular: 0.99 }, fulfillment: { instore: true } }] },
          { upc: "0002", productId: "p2", description: "Organic Red Onion", items: [{ price: { promo: 1.49, regular: 1.79 }, fulfillment: {} }] },
          { productId: "noupc", description: "skip me" }, // no UPC → dropped
        ],
      },
      "red onion",
      "1 each"
    );
    expect(row.matched).toMatchObject({ upc: "0001", description: "Red Onion", price: 0.99, available: true });
    expect(row.alternates).toHaveLength(1);
    expect(row.alternates[0]).toMatchObject({ upc: "0002", price: 1.49 }); // promo preferred
    expect(row.quantity).toBe(1);
    expect(row.include).toBe(true);
  });

  it("review row with no matches is excluded by default", () => {
    const row = toReviewRow({ data: [] }, "unobtanium", "as needed");
    expect(row.matched).toBeNull();
    expect(row.include).toBe(false);
  });
});
