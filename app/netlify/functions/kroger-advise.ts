// POST /api/kroger/advise — authed. Body: { items: [{ name, displayQty, section }] }.
// AI advisor that fixes questionable product matches: it searches each item, flags ones whose
// match contradicts the expected aisle (e.g. shallots → Deli), and asks Claude to pick the
// right product among the candidates (or a better search term, which we re-search + remember).
// Returns corrected review rows + how many were fixed. Always bypasses the cache (force).
import { getUser, householdIdFor, getConnection, getAliases, saveAlias } from "./_shared/supa";
import { clientCredToken, searchProducts } from "./_shared/kroger-api";
import { toReviewRow, krogerDepartmentToSection, type ReviewRow, type ProductMatch } from "./_shared/kroger";
import { adviseMatches, hasClaude } from "./_shared/kroger-advisor";
import { json } from "./_shared/http";

type Item = { name: string; displayQty?: string; section?: string };

export default async (req: Request): Promise<Response> => {
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const householdId = await householdIdFor(user.id);
  if (!householdId) return json({ error: "no household" }, 403);

  const conn = await getConnection(householdId);
  if (!conn?.location_id) return json({ error: "no_store" }, 409);
  const locationId = conn.location_id;

  const body = (await req.json().catch(() => ({}))) as { items?: Item[] };
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return json({ rows: [], fixed: 0 });
  if (!hasClaude(process.env)) return json({ error: "ai_unconfigured" }, 501);

  try {
    const aliases = await getAliases(householdId);
    const token = await clientCredToken(process.env);
    const rows = new Map<string, ReviewRow>();
    await Promise.all(
      items.map(async (it) => {
        const term = aliases.get(it.name) || it.name;
        rows.set(it.name, toReviewRow(await searchProducts(process.env, token, term, locationId), it.name, it.displayQty ?? "", it.section ?? null));
      })
    );

    // Questionable = no match, or the matched product's department contradicts the expected aisle.
    const questionable = items.filter((it) => {
      const row = rows.get(it.name)!;
      if (!row.matched) return true;
      const dept = krogerDepartmentToSection(row.matched.department);
      return Boolean(it.section && dept && dept !== it.section);
    });

    let fixed = 0;
    if (questionable.length) {
      const picks = await adviseMatches(
        process.env,
        questionable.map((it) => {
          const row = rows.get(it.name)!;
          const cands = [row.matched, ...row.alternates].filter(Boolean) as ProductMatch[];
          return { name: it.name, section: it.section ?? null, candidates: cands.map((c) => ({ upc: c.upc, description: c.description, department: c.department, price: c.price })) };
        })
      );

      for (const pick of picks) {
        const it = questionable.find((q) => q.name === pick.name);
        if (!it) continue;
        const row = rows.get(it.name)!;
        const all = [row.matched, ...row.alternates].filter(Boolean) as ProductMatch[];
        if (pick.chosenUpc) {
          const chosen = all.find((c) => c.upc === pick.chosenUpc);
          if (chosen && chosen.upc !== row.matched?.upc) {
            row.matched = chosen;
            row.alternates = all.filter((c) => c.upc !== chosen.upc);
            row.include = true;
            fixed++;
          }
        } else if (pick.betterTerm?.trim()) {
          const term = pick.betterTerm.trim();
          const newRow = toReviewRow(await searchProducts(process.env, token, term, locationId), it.name, it.displayQty ?? "", it.section ?? null);
          if (newRow.matched) {
            rows.set(it.name, newRow);
            await saveAlias(householdId, it.name, term, user.id).catch(() => {}); // remember for future matches
            fixed++;
          }
        }
      }
    }

    return json({ rows: items.map((it) => rows.get(it.name)!), fixed });
  } catch (e) {
    console.warn("[kroger] advise error:", (e as Error).message);
    return json({ error: "advise_failed", detail: (e as Error).message }, 502);
  }
};
