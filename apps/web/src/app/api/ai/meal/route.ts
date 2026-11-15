import { z } from "zod";
import { estimateMeal, refineMeal, supersedeEstimate } from "@nutria/ai";
import { json, route } from "@/lib/api";
import { aiCtx, Images, toImages, withAi } from "@/lib/ai";
import { db } from "@/lib/db";
import { draftImages, getDraft } from "@/lib/meal-drafts";

const When = {
  mealSlot: z.string().max(40).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
};

const Estimate = z.object({
  personId: z.string().uuid(),
  text: z.string().max(2000).optional(),
  images: Images.optional(),
  /** Analyse a saved meal (its photos before / leftovers are read here, not uploaded again). */
  draftId: z.string().uuid().optional(),
  mode: z.enum(["text", "voice", "photo"]),
  /** A pending estimate this new analysis replaces (the person went back to add details). */
  supersedes: z.string().uuid().optional(),
  ...When,
});

/** Correct the list in words, without the photos: the AI revises the current rows. */
const Refine = z.object({
  personId: z.string().uuid(),
  refineOf: z.string().uuid(),
  correction: z.string().trim().min(2).max(500),
  items: z.array(z.object({ name: z.string().max(200), grams: z.number().min(0).max(5000), servingLabel: z.string().max(80).nullish(), kcalPer100: z.number().min(0).max(1000).nullish() })).max(30),
  ...When,
});

/** AI meal estimate (text / voice transcript / photos + note, a saved meal, or a correction). Nothing is saved to the diary here. */
export const POST = route(async (req, user) => {
  const raw = await req.json();
  if (raw && typeof raw === "object" && "refineOf" in raw) {
    const b = Refine.parse(raw);
    const c = await aiCtx(user, b.personId, "diary", req);
    return withAi(async () => json(await refineMeal(c, { refineOf: b.refineOf, correction: b.correction, items: b.items, mealSlot: b.mealSlot, date: b.date, time: b.time })));
  }
  const b = Estimate.parse(raw);
  if (!b.draftId && !b.text?.trim() && !b.images?.length) return json({ error: "Escribe algo o añade una foto" }, 400);
  const c = await aiCtx(user, b.personId, "diary", req);
  const done = async (r: Awaited<ReturnType<typeof estimateMeal>>) => {
    if (b.supersedes) await supersedeEstimate(db(), user.id, b.supersedes);
    return json(r);
  };
  if (b.draftId) {
    const d = await getDraft(c.personId, b.draftId);
    const text = [d.text, b.text].map((t) => t?.trim()).filter(Boolean).join("\n");
    const [before, after] = await Promise.all([draftImages(d, "before"), draftImages(d, "after")]);
    if (!before.length && !text) return json({ error: "Esa comida no tiene fotos ni descripción" }, 400);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: c.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d.startedAt);
    return withAi(async () => done(await estimateMeal(c, { text: text || undefined, images: before, leftoverImages: after, mode: before.length ? "photo" : "text", mealSlot: b.mealSlot ?? d.mealSlot ?? undefined, date: d.date, time })));
  }
  return withAi(async () => done(await estimateMeal(c, { text: b.text, images: b.images ? toImages(b.images) : undefined, mode: b.mode, mealSlot: b.mealSlot, date: b.date, time: b.time })));
});
