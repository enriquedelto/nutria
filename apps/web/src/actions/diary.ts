"use server";
import { UserError } from "@/lib/errors";
import { refresh } from "next/cache";
import { z } from "zod";
import { and, dailySummaries, diaryEntries, eq, foodFavorites, foods, isNull, mealTemplates, or, persons, waterLogs, type MealTemplateItem } from "@nutria/db";
import { copyMeal, deleteEntries, logTemplate, recomputeDay, saveMealAsTemplate, undoAiAction, updateEntry, zonedTime } from "@nutria/core";
import { db } from "@/lib/db";
import { addDiaryItems, translateIfNeeded, type AddPayload } from "@/lib/diary-service";
import { assertAccess, getApiUser } from "@/lib/session";

async function user() {
  const u = await getApiUser();
  if (!u) throw new UserError("No autenticado");
  return u;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function addItems(payload: AddPayload) {
  const u = await user();
  const rows = await addDiaryItems(u.id, payload);
  refresh();
  return { ids: rows.map((r) => r.id), actionId: rows.actionId };
}

export async function editEntry(
  personId: string,
  id: string,
  { eatenTime, ...patch }: { grams?: number; mealSlot?: string; date?: string; lockedValues?: Record<string, number>; note?: string | null; foodId?: string; /** "HH:MM" on the entry's date; null clears it. */ eatenTime?: string | null },
) {
  const u = await user();
  await assertAccess(u.id, personId, "diary", true);
  let eatenAt: Date | null | undefined;
  if (eatenTime !== undefined) {
    if (eatenTime === null) eatenAt = null;
    else {
      const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).parse(eatenTime);
      const [e] = await db().select({ date: diaryEntries.date, tz: persons.timezone }).from(diaryEntries).innerJoin(persons, eq(persons.id, diaryEntries.personId)).where(and(eq(diaryEntries.id, id), eq(diaryEntries.personId, personId))).limit(1);
      if (!e) throw new UserError("Registro no encontrado");
      eatenAt = zonedTime(patch.date ?? e.date, hhmm, e.tz);
    }
  }
  if (patch.foodId) {
    // Only foods visible to the person's household (public catalogue or their own custom foods).
    const [p] = await db().select({ groupId: persons.groupId }).from(persons).where(eq(persons.id, personId)).limit(1);
    const groupId = p?.groupId ?? null;
    const [f] = await db().select({ id: foods.id }).from(foods).where(and(eq(foods.id, z.string().uuid().parse(patch.foodId)), groupId ? or(isNull(foods.groupId), eq(foods.groupId, groupId)) : isNull(foods.groupId))).limit(1);
    if (!f) throw new UserError("Ese alimento no está disponible");
  }
  await updateEntry(db(), personId, id, { ...patch, ...(eatenAt !== undefined ? { eatenAt } : {}) });
  if (patch.foodId) void translateIfNeeded([patch.foodId]);
  refresh();
}

export async function removeEntries(personId: string, ids: string[]) {
  const u = await user();
  await assertAccess(u.id, personId, "diary", true);
  await deleteEntries(db(), personId, z.array(z.string().uuid()).max(200).parse(ids));
  refresh();
}

export async function copyMealTo(personId: string, fromDate: string, toDate: string, fromSlot?: string, toSlot?: string) {
  const u = await user();
  await assertAccess(u.id, personId, "diary", true);
  const rows = await copyMeal(db(), { personId, userId: u.id, fromDate: date.parse(fromDate), toDate: date.parse(toDate), fromSlot, toSlot });
  refresh();
  return rows.length;
}

export async function addWater(personId: string, day: string, ml: number) {
  const u = await user();
  await assertAccess(u.id, personId, "diary", true);
  await db().insert(waterLogs).values({ personId, date: date.parse(day), ml: z.number().int().min(-2000).max(3000).parse(ml) });
  await recomputeDay(db(), personId, day);
  refresh();
}

export async function undoAi(actionId: string) {
  const u = await user();
  const ok = await undoAiAction(db(), u.id, z.string().uuid().parse(actionId));
  refresh();
  return ok;
}

export async function setDayComplete(personId: string, day: string, complete: boolean) {
  const u = await user();
  await assertAccess(u.id, personId, "diary", true);
  await recomputeDay(db(), personId, day);
  await db().update(dailySummaries).set({ complete }).where(and(eq(dailySummaries.personId, personId), eq(dailySummaries.date, day)));
  refresh();
}

export async function toggleFavorite(personId: string, foodId: string) {
  const u = await user();
  await assertAccess(u.id, personId, "diary", true);
  const [f] = await db().select().from(foodFavorites).where(and(eq(foodFavorites.personId, personId), eq(foodFavorites.foodId, foodId))).limit(1);
  if (f) await db().delete(foodFavorites).where(eq(foodFavorites.id, f.id));
  else await db().insert(foodFavorites).values({ personId, foodId });
  refresh();
  return !f;
}

export async function saveTemplate(personId: string, name: string, mealSlot: string | null, items: MealTemplateItem[]) {
  const u = await user();
  await assertAccess(u.id, personId, "diary", true);
  await db().insert(mealTemplates).values({ personId, name: z.string().min(1).max(80).parse(name), mealSlot, items });
  refresh();
}

/** Save a logged meal as a template (its foods and grams). */
export async function saveMealTemplate(personId: string, day: string, slot: string, name: string) {
  const u = await user();
  await assertAccess(u.id, personId, "diary", true);
  try {
    await saveMealAsTemplate(db(), personId, date.parse(day), z.string().min(1).max(40).parse(slot), z.string().trim().min(1).max(80).parse(name));
  } catch (e) {
    throw new UserError(e instanceof z.ZodError ? "Ponle un nombre a la plantilla" : e instanceof Error ? e.message : "No se pudo guardar");
  }
  refresh();
}

/** Log every food of a template in one go. Returns how many entries were added. */
export async function logTemplateAction(personId: string, templateId: string, day: string, slot: string) {
  const u = await user();
  await assertAccess(u.id, personId, "diary", true);
  try {
    const r = await logTemplate(db(), { personId, userId: u.id, templateId: z.string().uuid().parse(templateId), date: date.parse(day), slot: z.string().min(1).max(40).parse(slot) });
    refresh();
    return r.rows.length;
  } catch (e) {
    throw new UserError(e instanceof Error && !(e instanceof z.ZodError) ? e.message : "No se pudo registrar");
  }
}

export async function deleteTemplate(personId: string, id: string) {
  const u = await user();
  await assertAccess(u.id, personId, "diary", true);
  await db().delete(mealTemplates).where(and(eq(mealTemplates.id, id), eq(mealTemplates.personId, personId)));
  refresh();
}
