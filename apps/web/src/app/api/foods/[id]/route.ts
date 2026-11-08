import { z } from "zod";
import { foodDetail } from "@/lib/data/foods";
import { HttpError, json, personFor, route } from "@/lib/api";

/** GET /api/foods/:id?personId= — detail, servings, additives, alerts and healthier swaps. */
export const GET = route<RouteContext<"/api/foods/[id]">>(async (req, user, ctx) => {
  const id = z.string().uuid().parse((await ctx.params).id);
  const { person } = await personFor(user, new URL(req.url).searchParams.get("personId"), "diary");
  const detail = await foodDetail(id, person.id, person.groupId);
  if (!detail) throw new HttpError(404, "Alimento no encontrado");
  return json(detail);
});
