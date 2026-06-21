// POST /api/kroger/sent — authed. Maintains MealMesh's record of what it added to the
// Kroger cart. The public Cart API can't read or clear the cart, so the review step uses
// this self-tracked history to flag duplicates and removals.
//   Body { items: [{ upc, name, quantity }] } → append/merge to the history.
//   Body { clear: true }                      → reset it (use after checking out).
// Returns the updated { sentItems }.
import { getUser, householdIdFor, getConnection, setSentItems } from "./_shared/supa";
import { mergeSentItems, type SentItem } from "./_shared/kroger";
import { json } from "./_shared/http";

export default async (req: Request): Promise<Response> => {
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const householdId = await householdIdFor(user.id);
  if (!householdId) return json({ error: "no household" }, 403);

  // A connection row must exist (the user has to be connected to have sent anything).
  const conn = await getConnection(householdId);
  if (!conn) return json({ error: "not_connected" }, 409);

  const body = (await req.json().catch(() => ({}))) as {
    items?: { upc?: string; name?: string; quantity?: number }[];
    clear?: boolean;
  };

  if (body.clear) {
    await setSentItems(householdId, []);
    return json({ ok: true, sentItems: [] });
  }

  const now = Date.now();
  const added: SentItem[] = (body.items ?? [])
    .filter((i) => i.upc)
    .map((i) => ({
      upc: String(i.upc).trim(),
      name: String(i.name ?? "").slice(0, 120),
      quantity: Math.max(1, Math.floor(Number(i.quantity) || 1)),
      sentAt: now,
    }));

  const merged = mergeSentItems(conn.sent_items ?? [], added);
  await setSentItems(householdId, merged);
  return json({ ok: true, sentItems: merged });
};
