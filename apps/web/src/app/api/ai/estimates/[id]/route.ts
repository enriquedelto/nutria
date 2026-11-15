import { z } from "zod";
import { json, route } from "@/lib/api";
import { discardEstimate, saveReview } from "@/lib/meal-estimates";

const Review = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).max(30),
  slot: z.string().max(40),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().max(5),
  factor: z.number().min(0.25).max(4).optional(),
});
const Patch = z.union([z.object({ review: Review }), z.object({ discard: z.literal(true) })]);

/** Save the review state of a pending meal estimate (to resume it later) or discard it. */
export const PATCH = route<RouteContext<"/api/ai/estimates/[id]">>(async (req, user, ctx) => {
  const id = z.string().uuid().parse((await ctx.params).id);
  const p = Patch.parse(await req.json());
  if ("discard" in p) {
    await discardEstimate(user.id, id);
    return json({ ok: true });
  }
  return json({ ok: await saveReview(user.id, id, p.review) });
});
