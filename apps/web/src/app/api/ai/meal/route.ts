import { z } from "zod";
import { estimateMeal } from "@nutria/ai";
import { json, route } from "@/lib/api";
import { aiCtx, Images, toImages, withAi } from "@/lib/ai";
import { draftImages, getDraft } from "@/lib/meal-drafts";

const Body = z.object({
  personId: z.string().uuid(),
  text: z.string().max(2000).optional(),
  images: Images.optional(),
  /** Analyse a saved meal (its photos before / leftovers are read here, not uploaded again). */
  draftId: z.string().uuid().optional(),
  mode: z.enum(["text", "voice", "photo"]),
  mealSlot: z.string().max(40).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});

/** AI meal estimate (text / voice transcript / photos + note, or a saved meal). Nothing is saved to the diary here. */
export const POST = route(async (req, user) => {
  const b = Body.parse(await req.json());
  if (!b.draftId && !b.text?.trim() && !b.images?.length) return json({ error: "Escribe algo o añade una foto" }, 400);
  const c = await aiCtx(user, b.personId, "diary", req);
  if (b.draftId) {
    const d = await getDraft(c.personId, b.draftId);
    const text = [d.text, b.text].map((t) => t?.trim()).filter(Boolean).join("\n");
    const [before, after] = await Promise.all([draftImages(d, "before"), draftImages(d, "after")]);
    if (!before.length && !text) return json({ error: "Esa comida no tiene fotos ni descripción" }, 400);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: c.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d.startedAt);
    return withAi(async () => json(await estimateMeal(c, { text: text || undefined, images: before, leftoverImages: after, mode: before.length ? "photo" : "text", mealSlot: b.mealSlot ?? d.mealSlot ?? undefined, date: d.date, time })));
  }
  return withAi(async () => json(await estimateMeal(c, { text: b.text, images: b.images ? toImages(b.images) : undefined, mode: b.mode, mealSlot: b.mealSlot, date: b.date, time: b.time })));
});
