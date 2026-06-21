// POST /api/kroger/match — authed. Body: { items: [{ name, displayQty }] }. Matches each
// shopping item to a Kroger product at the chosen store; returns review rows.
import { getUser, householdIdFor, getConnection, getAliases } from "./_shared/supa";
import { clientCredToken, searchProducts } from "./_shared/kroger-api";
import { toReviewRow } from "./_shared/kroger";
import { json } from "./_shared/http";

export default async (req: Request): Promise<Response> => {
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const householdId = await householdIdFor(user.id);
  if (!householdId) return json({ error: "no household" }, 403);

  const conn = await getConnection(householdId);
  if (!conn?.location_id) return json({ error: "no_store" }, 409); // pick a store first

  const body = (await req.json().catch(() => ({}))) as {
    items?: { name: string; displayQty?: string }[];
  };
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return json({ rows: [] });

  try {
    const [token, aliases] = await Promise.all([clientCredToken(process.env), getAliases(householdId)]);
    const rows = await Promise.all(
      items.map(async (it) => {
        // Search a remembered alternative term when one exists, but keep the row keyed to the
        // original item name so it still maps back to the shopping-list item.
        const term = aliases.get(it.name) || it.name;
        return toReviewRow(await searchProducts(process.env, token, term, conn.location_id!), it.name, it.displayQty ?? "");
      })
    );
    return json({ rows });
  } catch (e) {
    console.warn("[kroger] match error:", (e as Error).message);
    return json({ error: "match_failed", detail: (e as Error).message }, 502);
  }
};
