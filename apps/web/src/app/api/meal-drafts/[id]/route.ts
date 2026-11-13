import { z } from "zod";
import { mealDrafts, eq } from "@nutria/db";
import { db } from "@/lib/db";
import { HttpError, json, personFor, route } from "@/lib/api";
import { deleteDraft, DraftImages, publicDraft, updateDraft } from "@/lib/meal-drafts";

async function load(id: string) {
  const [d] = await db().select().from(mealDrafts).where(eq(mealDrafts.id, z.string().uuid().parse(id))).limit(1);
  if (!d) throw new HttpError(404, "Esa comida ya no está");
  return d;
}

const Patch = z.object({
  images: DraftImages.optional(),
  phase: z.enum(["before", "after"]).default("after"),
  text: z.string().max(2000).optional(),
  mealSlot: z.string().max(40).nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startedAt: z.string().datetime().optional(),
  status: z.enum(["open", "pending"]).optional(),
});

/** Add leftover (or more "before") photos, edit the note/meal/time, or park it as pending. */
export const PATCH = route<RouteContext<"/api/meal-drafts/[id]">>(async (req, user, ctx) => {
  const d = await load((await ctx.params).id);
  await personFor(user, d.personId, "diary", true);
  const p = Patch.parse(await req.json());
  const u = await updateDraft(d, { ...p, startedAt: p.startedAt ? new Date(p.startedAt) : undefined });
  return json(publicDraft(u));
});

export const DELETE = route<RouteContext<"/api/meal-drafts/[id]">>(async (_req, user, ctx) => {
  const d = await load((await ctx.params).id);
  await personFor(user, d.personId, "diary", true);
  await deleteDraft(d);
  return json({ ok: true });
});
