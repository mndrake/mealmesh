// POST /api/kroger/match — authed. Body: { items: [{ name, displayQty }], force? }.
// Matches each shopping item to a Kroger product at the chosen store. Results are cached
// per household+item+store; we only call the Kroger API for items whose cache is missing
// or stale (older than the TTL), unless `force` is set (refresh / manual search).
import { getUser, householdIdFor, getConnection, getAliases, getProductCache, upsertProductCache } from "./_shared/supa";
import { clientCredToken, searchProducts } from "./_shared/kroger-api";
import { toReviewRow, isCacheFresh, type ReviewRow, type ProductMatch } from "./_shared/kroger";
import { json } from "./_shared/http";

type Item = { name: string; displayQty?: string; section?: string };

export default async (req: Request): Promise<Response> => {
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const householdId = await householdIdFor(user.id);
  if (!householdId) return json({ error: "no household" }, 403);

  const conn = await getConnection(householdId);
  if (!conn?.location_id) return json({ error: "no_store" }, 409); // pick a store first
  const locationId = conn.location_id;

  const body = (await req.json().catch(() => ({}))) as { items?: Item[]; force?: boolean; noAlias?: boolean };
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return json({ rows: [] });

  const rowFromCache = (it: Item, data: { matched?: ProductMatch | null; alternates?: ProductMatch[] }): ReviewRow => ({
    listName: it.name,
    displayQty: it.displayQty ?? "",
    matched: data.matched ?? null,
    alternates: data.alternates ?? [],
    quantity: 1,
    include: Boolean(data.matched),
  });

  try {
    const now = Date.now();
    const [aliases, cache] = await Promise.all([
      getAliases(householdId),
      body.force ? Promise.resolve(new Map()) : getProductCache(householdId),
    ]);

    // Items whose cache is missing/stale need a live search.
    const needSearch = items.filter((it) => !isCacheFresh(cache.get(it.name), locationId, now));
    const token = needSearch.length ? await clientCredToken(process.env) : null;

    const searched = new Map<string, ReviewRow>();
    const toCache: { itemName: string; locationId: string; data: unknown }[] = [];
    await Promise.all(
      needSearch.map(async (it) => {
        const term = body.noAlias ? it.name : aliases.get(it.name) || it.name; // remembered alternative term, if any
        const row = toReviewRow(await searchProducts(process.env, token!, term, locationId), it.name, it.displayQty ?? "", it.section ?? null);
        searched.set(it.name, row);
        toCache.push({ itemName: it.name, locationId, data: { matched: row.matched, alternates: row.alternates } });
      })
    );

    const rows = items.map(
      (it) => searched.get(it.name) ?? rowFromCache(it, (cache.get(it.name)!.data as { matched?: ProductMatch | null; alternates?: ProductMatch[] }))
    );

    if (toCache.length) await upsertProductCache(householdId, toCache).catch(() => {}); // best-effort
    return json({ rows });
  } catch (e) {
    console.warn("[kroger] match error:", (e as Error).message);
    return json({ error: "match_failed", detail: (e as Error).message }, 502);
  }
};
