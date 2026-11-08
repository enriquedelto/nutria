import { z } from "zod";
import { estimateMeal } from "@nutria/ai";
import { json, route } from "@/lib/api";
import { aiCtx, Images, toImages, withAi } from "@/lib/ai";

const Body = z.object({
  personId: z.string().uuid(),
  text: z.string().max(2000).optional(),
  images: Images.optional(),
  mode: z.enum(["text", "voice", "photo"]),
  mealSlot: z.string().max(40).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** AI meal estimate (text / voice transcript / photos + note). Nothing is saved to the diary here. */
export const POST = route(async (req, user) => {
  const b = Body.parse(await req.json());
  if (!b.text?.trim() && !b.images?.length) return json({ error: "Escribe algo o añade una foto" }, 400);
  const c = await aiCtx(user, b.personId, "diary", req);
  return withAi(async () => json(await estimateMeal(c, { text: b.text, images: b.images ? toImages(b.images) : undefined, mode: b.mode, mealSlot: b.mealSlot, date: b.date })));
});
