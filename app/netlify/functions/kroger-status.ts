// GET /api/kroger/status — sanitized connection status for the caller's household.
// Never returns tokens.
import { getUser, householdIdFor, getConnection } from "./_shared/supa";
import { json } from "./_shared/http";

export default async (req: Request): Promise<Response> => {
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const householdId = await householdIdFor(user.id);
  if (!householdId) return json({ connected: false, storeName: null, modality: "PICKUP" });

  const conn = await getConnection(householdId);
  return json({
    connected: Boolean(conn?.refresh_token),
    storeName: conn?.store_name ?? null,
    modality: conn?.modality ?? "PICKUP",
  });
};
