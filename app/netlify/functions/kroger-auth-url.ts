// GET /api/kroger/auth-url — authenticated. Mints a CSRF state mapped to the caller's
// household and returns the Kroger authorize URL the browser opens to grant cart access.
import { getUser, householdIdFor, putState } from "./_shared/supa";
import { apiBase, authorizeUrl } from "./_shared/kroger";
import { json } from "./_shared/http";

export default async (req: Request): Promise<Response> => {
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const householdId = await householdIdFor(user.id);
  if (!householdId) return json({ error: "no household" }, 403);

  const state = crypto.randomUUID();
  await putState(state, householdId, user.id);

  const url = authorizeUrl({
    base: apiBase(process.env),
    clientId: process.env.KROGER_CLIENT_ID!,
    redirectUri: process.env.KROGER_REDIRECT_URI!,
    state,
    scopes: ["cart.basic:write"],
  });
  return json({ url });
};
