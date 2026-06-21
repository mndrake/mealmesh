// POST /api/kroger/alias — authed. Body: { itemName, searchTerm }. Remembers a better
// search term for a shopping item so future matches use it (see item_aliases). An empty
// searchTerm clears the alias.
import { getUser, householdIdFor, saveAlias, service } from "./_shared/supa";
import { json } from "./_shared/http";

export default async (req: Request): Promise<Response> => {
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const householdId = await householdIdFor(user.id);
  if (!householdId) return json({ error: "no household" }, 403);

  const body = (await req.json().catch(() => ({}))) as { itemName?: string; searchTerm?: string };
  const itemName = String(body.itemName ?? "").trim();
  const searchTerm = String(body.searchTerm ?? "").trim();
  if (!itemName) return json({ error: "no_item" }, 400);

  if (!searchTerm) {
    await service().from("item_aliases").delete().eq("household_id", householdId).eq("item_name", itemName);
    return json({ ok: true });
  }
  await saveAlias(householdId, itemName, searchTerm, user.id);
  return json({ ok: true });
};
