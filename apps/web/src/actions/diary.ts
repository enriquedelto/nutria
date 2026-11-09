"use server";
import { UserError } from "@/lib/errors";
import { refresh } from "next/cache";
import { z } from "zod";
import { and, dailySummaries, eq, foodFavorites, foods, isNull, mealTemplates, or, persons, waterLogs, type MealTemplateItem } from "@nutria/db";
import { copyMeal, deleteEntries, recomputeDay, undoAiAction, updateEntry } from "@nutria/core";
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

export async function editEntry(personId: string, id: string, patch: { grams?: number; mealSlot?: string; date?: string; lockedValues?: Record<string, number>; note?: string | null; foodId?: string }) {
  const u = await user();
  await assertAccess(u.id, personId, "diary", true);
  if (patch.foodId) {
    // Only foods visible to the person's household (public catalogue or their own custom foods).
    const [p] = await db().select({ groupId: persons.groupId }).from(persons).where(eq(persons.id, personId)).limit(1);
    const groupId = p?.groupId ?? null;
    const [f] = await db().select({ id: foods.id }).from(foods).where(and(eq(foods.id, z.string().uuid().parse(patch.foodId)), groupId ? or(isNull(foods.groupId), eq(foods.groupId, groupId)) : isNull(foods.groupId))).limit(1);
    if (!f) throw new UserError("Ese alimento no está disponible");
  }
  await updateEntry(db(), personId, id, patch);
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

export async function deleteTemplate(personId: string, id: string) {
  const u = await user();
  await assertAccess(u.id, personId, "diary", true);
  await db().delete(mealTemplates).where(and(eq(mealTemplates.id, id), eq(mealTemplates.personId, personId)));
  refresh();
}
