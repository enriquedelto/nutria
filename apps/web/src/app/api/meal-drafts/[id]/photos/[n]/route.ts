import { z } from "zod";
import { mealDrafts, eq } from "@nutria/db";
import { db } from "@/lib/db";
import { HttpError, personFor, route } from "@/lib/api";
import { readPhoto } from "@/lib/meal-drafts";

/** A draft photo, decrypted (private, same access as the diary). */
export const GET = route<RouteContext<"/api/meal-drafts/[id]/photos/[n]">>(async (_req, user, ctx) => {
  const { id, n } = await ctx.params;
  const [d] = await db().select().from(mealDrafts).where(eq(mealDrafts.id, z.string().uuid().parse(id))).limit(1);
  if (!d) throw new HttpError(404, "Esa comida ya no está");
  await personFor(user, d.personId, "diary");
  const buf = await readPhoto(d, z.coerce.number().int().min(0).max(20).parse(n));
  return new Response(new Uint8Array(buf), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
});
