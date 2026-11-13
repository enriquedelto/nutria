import { z } from "zod";
import { json, personFor, route } from "@/lib/api";
import { createDraft, DraftImages, listDrafts, publicDraft } from "@/lib/meal-drafts";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Meal drafts of a person: being eaten (photo before) or saved to analyse later. */
export const GET = route(async (req, user) => {
  const { person } = await personFor(user, new URL(req.url).searchParams.get("personId"), "diary");
  return json(await listDrafts(person.id));
});

const Body = z.object({
  personId: z.string().uuid(),
  date: day,
  mealSlot: z.string().max(40).nullish(),
  startedAt: z.string().datetime(),
  text: z.string().max(2000).default(""),
  status: z.enum(["open", "pending"]).default("open"),
  images: DraftImages.default([]),
});

export const POST = route(async (req, user) => {
  const b = Body.parse(await req.json());
  if (!b.images.length && !b.text.trim()) return json({ error: "Añade una foto o una descripción" }, 400);
  const { person } = await personFor(user, b.personId, "diary", true);
  const d = await createDraft({ personId: person.id, userId: user.id, date: b.date, mealSlot: b.mealSlot ?? null, startedAt: new Date(b.startedAt), text: b.text, status: b.status, images: b.images });
  return json(publicDraft(d), 201);
});
