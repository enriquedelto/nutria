import { z } from "zod";
import { EXPLORE_ORIGINS, EXPLORE_SORTS, exploreFoods } from "@nutria/db";
import { ALLERGEN_TAGS } from "@nutria/nutrition";
import { db } from "@/lib/db";
import { json, personFor, route } from "@/lib/api";

const flag = z.enum(["1", "0"]).optional().transform((v) => v === "1");
const num = z.coerce.number().min(0).max(5000).optional();

/** Query string shared with the Explorar tab (also its URL state). */
const ExploreQuery = z.object({
  q: z.string().max(100).optional(),
  grupo: z.string().max(40).optional(),
  origen: z.enum(EXPLORE_ORIGINS).optional(),
  orden: z.enum(EXPLORE_SORTS).optional(),
  kmin: num,
  kmax: num,
  pmin: num,
  altoprot: flag,
  pocoazucar: flag,
  pocasal: flag,
  ns: z.string().regex(/^[a-e]{1,5}$/).optional(),
  nova: z.coerce.number().int().min(1).max(4).optional(),
  sinalergenos: flag,
  vegano: flag,
  singluten: flag,
  precio: flag,
  desde: z.coerce.number().int().min(0).max(5000).optional(),
});

/** GET /api/foods/explore?personId=&grupo=&orden=… — browse the catalogue with filters. */
export const GET = route(async (req, user) => {
  const u = new URL(req.url);
  const { person } = await personFor(user, u.searchParams.get("personId"), "diary");
  const p = ExploreQuery.parse(Object.fromEntries([...u.searchParams].filter(([k, v]) => k !== "personId" && v !== "")));
  const limit = 30;
  const rows = await exploreFoods(
    db(),
    {
      q: p.q,
      group: p.grupo,
      origin: p.origen,
      sort: p.orden,
      kcalMin: p.kmin,
      kcalMax: p.kmax,
      proteinMin: p.pmin,
      highProtein: p.altoprot,
      lowSugar: p.pocoazucar,
      lowSalt: p.pocasal,
      nutriscore: p.ns ? [...p.ns] : undefined,
      novaMax: p.nova,
      withoutAllergens: p.sinalergenos ? person.allergens.map((a) => ALLERGEN_TAGS[a]?.tag).filter((t): t is string => !!t) : undefined,
      vegan: p.vegano,
      glutenFree: p.singluten,
      withPrice: p.precio,
    },
    { groupId: person.groupId, offset: p.desde ?? 0, limit },
  );
  const items = rows.slice(0, limit).map((r) => ({ ...r, price: r.price != null ? Number(r.price) : null, pricePerKg: r.pricePerKg != null ? Number(r.pricePerKg) : null }));
  return json({ items, more: rows.length > limit }, { headers: { "cache-control": "private, max-age=60" } });
});
