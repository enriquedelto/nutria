import { foodByBarcode } from "@nutria/core";
import { db } from "@/lib/db";
import { foodDetail } from "@/lib/data/foods";
import { HttpError, json, personFor, route } from "@/lib/api";

/** GET /api/foods/barcode/:code?personId= — local mirror first, then live Open Food Facts. */
export const GET = route<RouteContext<"/api/foods/barcode/[code]">>(async (req, user, ctx) => {
  const code = (await ctx.params).code.replace(/\D/g, "");
  if (code.length < 6 || code.length > 14) throw new HttpError(400, "Código no válido");
  const { person } = await personFor(user, new URL(req.url).searchParams.get("personId"), "diary");
  const food = await foodByBarcode(db(), code);
  if (!food) return json({ found: false, barcode: code }, 404);
  return json({ found: true, ...(await foodDetail(food.id, person.id, person.groupId)) });
});
