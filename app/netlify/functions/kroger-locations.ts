// GET /api/kroger/locations?zip= — authed. Returns nearby Mariano's stores to pick from.
import { getUser, householdIdFor } from "./_shared/supa";
import { clientCredToken, getLocations } from "./_shared/kroger-api";
import { toStores } from "./_shared/kroger";
import { json } from "./_shared/http";

export default async (req: Request): Promise<Response> => {
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (!(await householdIdFor(user.id))) return json({ error: "no household" }, 403);

  const zip = new URL(req.url).searchParams.get("zip") || process.env.KROGER_DEFAULT_ZIP || "";
  if (!zip) return json({ error: "zip required" }, 400);

  try {
    const token = await clientCredToken(process.env);
    const stores = toStores(await getLocations(process.env, token, zip));
    return json({ stores });
  } catch (e) {
    console.warn("[kroger] locations error:", (e as Error).message);
    return json({ error: "locations_failed" }, 502);
  }
};
