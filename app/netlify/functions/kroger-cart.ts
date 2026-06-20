// POST /api/kroger/cart — authed. Body: { items: [{ upc, quantity }], modality }.
// Adds the items to the household's Kroger cart using the stored user token (refreshing
// it when expired or on a 401). Tokens never leave the server.
import { getUser, householdIdFor, getConnection, saveTokens, setModality } from "./_shared/supa";
import { refreshUserToken, addToCart } from "./_shared/kroger-api";
import { needsRefresh, computeExpiresAt } from "./_shared/kroger";
import { json } from "./_shared/http";

export default async (req: Request): Promise<Response> => {
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const householdId = await householdIdFor(user.id);
  if (!householdId) return json({ error: "no household" }, 403);

  const conn = await getConnection(householdId);
  if (!conn?.refresh_token) return json({ error: "not_connected" }, 409);

  const body = (await req.json().catch(() => ({}))) as {
    items?: { upc: string; quantity: number }[];
    modality?: string;
  };
  const items = (body.items ?? []).filter((i) => i.upc && i.quantity > 0);
  const modality = body.modality === "DELIVERY" ? "DELIVERY" : "PICKUP";
  if (!items.length) return json({ error: "no_items" }, 400);

  // Ensure a fresh access token, then PUT to cart with one refresh-on-401 retry.
  let access = conn.access_token ?? "";
  const refresh = async () => {
    const t = await refreshUserToken(process.env, conn.refresh_token!);
    access = t.access_token;
    await saveTokens(
      householdId,
      {
        access_token: t.access_token,
        refresh_token: t.refresh_token ?? conn.refresh_token!,
        expires_at: new Date(computeExpiresAt(Date.now(), t.expires_in)).toISOString(),
      },
      null
    );
  };

  try {
    const expMs = conn.expires_at ? Date.parse(conn.expires_at) : null;
    if (!access || needsRefresh(expMs, Date.now())) await refresh();

    let res = await addToCart(process.env, access, items, modality);
    if (res.status === 401) {
      await refresh();
      res = await addToCart(process.env, access, items, modality);
    }
    if (res.status === 204) {
      await setModality(householdId, modality);
      return json({ ok: true, added: items.length });
    }
    console.warn("[kroger] cart add status:", res.status);
    return json({ error: "cart_failed", status: res.status }, 502);
  } catch (e) {
    console.warn("[kroger] cart error:", (e as Error).message);
    return json({ error: "cart_failed" }, 502);
  }
};
