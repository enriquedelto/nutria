import "server-only";
import { z } from "zod";
import { aiActions, and, desc, eq, foods, inArray, isNull } from "@nutria/db";
import { addEntries, DIARY_ORIGINS, DiaryItemInput } from "@nutria/core";
import { db } from "./db";
import { emit } from "./events";
import { enqueue } from "./jobs";
import { assertAccess } from "./session";

export const AddPayload = z.object({
  personId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealSlot: z.string().min(1).max(40),
  origin: z.enum(DIARY_ORIGINS).default("manual"),
  items: z.array(DiaryItemInput).min(1).max(50),
  estimateId: z.string().uuid().nullish(),
});
export type AddPayload = z.infer<typeof AddPayload>;

/** Shared by the server action and /api/diary (offline queue replay). */
/** Foods without a Spanish name (OFF products can come in any language) get translated in the background. */
export async function translateIfNeeded(foodIds: (string | null | undefined)[]) {
  const ids = [...new Set(foodIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  const [f] = await db().select({ id: foods.id }).from(foods).where(and(inArray(foods.id, ids), isNull(foods.nameEs))).limit(1);
  if (f) await enqueue("foods.translate", { usedOnly: true }, { singletonKey: "translate-used", startAfter: 20 });
}

export async function addDiaryItems(userId: string, raw: unknown) {
  const input = AddPayload.parse(raw);
  await assertAccess(userId, input.personId, "diary", true);
  const rows = await addEntries(db(), { ...input, userId, estimateId: input.estimateId ?? null });
  void enqueue("gamification.evaluate", { personId: input.personId }, { singletonKey: `gam:${input.personId}`, startAfter: 30 });
  void translateIfNeeded(rows.map((r) => r.foodId));
  void emit(userId, "diary.entry_created", { personId: input.personId, date: input.date, mealSlot: input.mealSlot, count: rows.length, kcal: Math.round(rows.reduce((a, r) => a + r.kcal, 0)) });
  let actionId: string | null = null;
  if (input.estimateId) {
    const [a] = await db().select({ id: aiActions.id }).from(aiActions).where(and(eq(aiActions.estimateId, input.estimateId), eq(aiActions.userId, userId), isNull(aiActions.undoneAt))).orderBy(desc(aiActions.createdAt)).limit(1);
    actionId = a?.id ?? null;
  }
  return Object.assign(rows, { actionId });
}
