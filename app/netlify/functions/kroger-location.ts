// POST /api/kroger/location — authed. Saves the chosen Mariano's store for the household.
import { getUser, householdIdFor, saveLocation } from "./_shared/supa";
import { json } from "./_shared/http";

export default async (req: Request): Promise<Response> => {
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const householdId = await householdIdFor(user.id);
  if (!householdId) return json({ error: "no household" }, 403);

  const body = (await req.json().catch(() => ({}))) as { locationId?: string; storeName?: string };
  if (!body.locationId) return json({ error: "locationId required" }, 400);

  await saveLocation(householdId, String(body.locationId), body.storeName ?? null);
  return json({ ok: true });
};
