import { describe, it, expect } from "vitest";
import {
  apiBase,
  basicAuthHeader,
  authorizeUrl,
  authCodeTokenBody,
  refreshTokenBody,
  computeExpiresAt,
  needsRefresh,
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
});
