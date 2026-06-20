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
  // Harden values: Kroger 400s on a non-integer quantity or a UPC with stray whitespace.
  const items = (body.items ?? [])
    .filter((i) => i.upc && i.quantity > 0)
    .map((i) => ({ upc: String(i.upc).trim(), quantity: Math.max(1, Math.floor(Number(i.quantity))) }));
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

  const put = async (its: { upc: string; quantity: number }[]): Promise<Response> => {
    let r = await addToCart(process.env, access, its, modality);
    if (r.status === 401) {
      await refresh();
      r = await addToCart(process.env, access, its, modality);
    }
    return r;
  };

  try {
    const expMs = conn.expires_at ? Date.parse(conn.expires_at) : null;
    if (!access || needsRefresh(expMs, Date.now())) await refresh();

    // Fast path: one batched call.
    const batch = await put(items);
    if (batch.status === 204) {
      await setModality(householdId, modality);
      return json({ ok: true, added: items.length, failed: [] });
    }

    // Kroger fails the whole batch if any single item is un-addable (e.g. a produce PLU).
    // Fall back to adding each item alone so the good ones still land, and report the rest.
    const batchDetail = (await batch.text().catch(() => "")).slice(0, 200);
    let added = 0;
    const failed: { upc: string; status: number }[] = [];
    for (const it of items) {
      const r = await put([it]);
      if (r.status === 204) added++;
      else failed.push({ upc: it.upc, status: r.status });
    }
    console.warn("[kroger] cart batch failed; per-item added:", added, "failed:", JSON.stringify(failed), batchDetail);

    if (added > 0) {
      await setModality(householdId, modality);
      return json({ ok: true, added, failed });
    }
    return json({ error: "cart_failed", status: batch.status, detail: batchDetail, failed }, 502);
  } catch (e) {
    console.warn("[kroger] cart error:", (e as Error).message);
    return json({ error: "cart_failed", detail: (e as Error).message }, 502);
  }
};
