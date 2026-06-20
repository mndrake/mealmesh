// POST /api/kroger/match — authed. Body: { items: [{ name, displayQty }] }. Matches each
// shopping item to a Kroger product at the chosen store; returns review rows.
import { getUser, householdIdFor, getConnection } from "./_shared/supa";
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
    const token = await clientCredToken(process.env);
    const rows = await Promise.all(
      items.map(async (it) =>
        toReviewRow(await searchProducts(process.env, token, it.name, conn.location_id!), it.name, it.displayQty ?? "")
      )
    );
    return json({ rows });
  } catch (e) {
    console.warn("[kroger] match error:", (e as Error).message);
    return json({ error: "match_failed" }, 502);
  }
};
