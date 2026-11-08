import { searchFoods } from "@nutria/db";
import { db } from "@/lib/db";
import { brief } from "@/lib/data/foods";
import { json, personFor, route } from "@/lib/api";

const KINDS = new Set(["food", "drink", "supplement", "alcohol"]);

/** GET /api/foods?q=&personId=&kind=  — unified local search (OFF mirror + CIQUAL + custom). */
export const GET = route(async (req, user) => {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").slice(0, 100);
  const { person } = await personFor(user, u.searchParams.get("personId"), "diary");
  const kinds = u.searchParams.getAll("kind").filter((k) => KINDS.has(k));
  const rows = await searchFoods(db(), q, { groupId: person.groupId, limit: Math.min(50, Number(u.searchParams.get("limit") ?? 25)), kinds: kinds.length ? (kinds as never) : undefined });
  return json({ items: rows.map(brief) }, { headers: { "cache-control": "private, max-age=60" } });
});
