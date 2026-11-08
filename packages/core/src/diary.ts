/**
 * Diary writes. Entries store a nutrient snapshot (so later food edits don't rewrite history);
 * `lockedValues` are per-100 g user corrections that scale with grams.
 * Every write originating from AI is recorded in ai_actions so it can be undone.
 */
import { aiActions, aiEstimates, and, batches, diaryEntries, eq, foods, inArray, isNull, sql, type Database } from "@nutria/db";
import { applyLocked, completeDerived, macroColumns, scaleNutrients, type NutrientMap } from "@nutria/nutrition";
import { z } from "zod";
import { recomputeDay } from "./summaries";

export const DiaryItemInput = z.object({
  foodId: z.string().uuid().nullish(),
  recipeId: z.string().uuid().nullish(),
  batchId: z.string().uuid().nullish(),
  name: z.string().min(1).max(200).optional(),
  brand: z.string().nullish(),
  grams: z.number().min(0).max(5000),
  servingLabel: z.string().nullish(),
  servingQty: z.number().nullish(),
  /** Per-100 g nutrients when there is no food (AI estimate / quick add per 100 g). */
  per100: z.record(z.string(), z.number()).optional(),
  /** Absolute nutrients for quick add (no grams scaling). */
  absolute: z.record(z.string(), z.number()).optional(),
  lockedValues: z.record(z.string(), z.number()).optional(),
  eatenAt: z.coerce.date().nullish(),
  note: z.string().max(500).nullish(),
  clientId: z.string().max(80).nullish(),
});
export type DiaryItemInput = z.infer<typeof DiaryItemInput>;

export const DIARY_ORIGINS = ["manual", "scan", "ai_text", "ai_photo", "ai_voice", "label", "plan", "import", "quick", "mcp", "batch", "recipe"] as const;
export type DiaryOrigin = (typeof DIARY_ORIGINS)[number];

export interface AddEntriesInput {
  personId: string;
  userId: string;
  date: string;
  mealSlot: string;
  origin: DiaryOrigin;
  items: DiaryItemInput[];
  estimateId?: string | null;
}

/** Insert diary entries (idempotent by clientId) and refresh the day summary. */
export async function addEntries(db: Database, input: AddEntriesInput) {
  const foodIds = input.items.map((i) => i.foodId).filter((x): x is string => !!x);
  const foodRows = foodIds.length ? await db.select().from(foods).where(inArray(foods.id, foodIds)) : [];
  const byId = new Map(foodRows.map((f) => [f.id, f]));
  const values = input.items.map((it) => {
    const f = it.foodId ? byId.get(it.foodId) : undefined;
    let nutrients: NutrientMap;
    if (it.absolute) nutrients = completeDerived(it.absolute);
    else {
      const per100 = f ? { ...f.nutrients, ...(f.kcal != null ? { energy_kcal: f.kcal } : {}) } : completeDerived(it.per100 ?? {});
      nutrients = scaleNutrients(per100, it.grams, it.lockedValues);
    }
    const m = macroColumns(nutrients);
    return {
      personId: input.personId,
      date: input.date,
      mealSlot: input.mealSlot,
      eatenAt: it.eatenAt ?? null,
      foodId: f?.id ?? null,
      recipeId: it.recipeId ?? null,
      batchId: it.batchId ?? null,
      name: it.name ?? f?.nameEs ?? f?.name ?? "Alimento",
      brand: it.brand ?? f?.brand ?? null,
      grams: it.grams,
      servingLabel: it.servingLabel ?? null,
      servingQty: it.servingQty ?? null,
      ...m,
      nutrients,
      lockedValues: it.lockedValues ?? {},
      nova: f?.nova ?? null,
      nutriscore: f?.nutriscore ?? null,
      origin: input.origin,
      aiEstimateId: input.estimateId ?? null,
      quick: !!it.absolute,
      note: it.note ?? null,
      createdBy: input.userId,
      clientId: it.clientId ?? null,
    };
  });
  if (!values.length) return [];
  const rows = await db.insert(diaryEntries).values(values).onConflictDoNothing({ target: diaryEntries.clientId, where: sql`${diaryEntries.clientId} is not null` }).returning();
  if (foodIds.length) await db.update(foods).set({ popularity: sql`${foods.popularity} + 1` }).where(inArray(foods.id, foodIds));
  // Eating from a batch (tupper) consumes portions.
  for (const it of input.items.filter((i) => i.batchId))
    if (rows.some((r) => r.batchId === it.batchId)) await db.update(batches).set({ portionsLeft: sql`greatest(0, ${batches.portionsLeft} - ${it.servingQty ?? 1})` }).where(eq(batches.id, it.batchId!));
  if (input.estimateId && rows.length) {
    await db.update(aiEstimates).set({ status: "confirmed", confirmedAt: new Date() }).where(eq(aiEstimates.id, input.estimateId));
    await db.insert(aiActions).values({ userId: input.userId, personId: input.personId, estimateId: input.estimateId, action: "insert", tableName: "diary_entries", rowIds: rows.map((r) => r.id) });
  }
  await recomputeDay(db, input.personId, input.date);
  return rows;
}

/** Update grams / locked values of an entry, re-scaling from its stored snapshot. */
export async function updateEntry(db: Database, personId: string, id: string, patch: { grams?: number; mealSlot?: string; date?: string; lockedValues?: NutrientMap; note?: string | null }) {
  const [e] = await db.select().from(diaryEntries).where(and(eq(diaryEntries.id, id), eq(diaryEntries.personId, personId))).limit(1);
  if (!e) return null;
  let nutrients = e.nutrients;
  const grams = patch.grams ?? e.grams;
  if (!e.quick && (patch.grams != null || patch.lockedValues)) {
    // Back out per-100 g from the snapshot, then re-apply locks.
    const per100 = e.grams > 0 ? scaleNutrients(e.nutrients, 10_000 / e.grams) : e.nutrients;
    const locked = { ...e.lockedValues, ...(patch.lockedValues ?? {}) };
    nutrients = scaleNutrients(applyLocked(per100, locked), grams);
  }
  const [u] = await db
    .update(diaryEntries)
    .set({ grams, nutrients, ...macroColumns(nutrients), mealSlot: patch.mealSlot ?? e.mealSlot, date: patch.date ?? e.date, lockedValues: { ...e.lockedValues, ...(patch.lockedValues ?? {}) }, note: patch.note === undefined ? e.note : patch.note })
    .where(eq(diaryEntries.id, id))
    .returning();
  await recomputeDay(db, personId, e.date);
  if (patch.date && patch.date !== e.date) await recomputeDay(db, personId, patch.date);
  return u!;
}

export async function deleteEntries(db: Database, personId: string, ids: string[]) {
  if (!ids.length) return 0;
  const rows = await db.delete(diaryEntries).where(and(eq(diaryEntries.personId, personId), inArray(diaryEntries.id, ids))).returning({ date: diaryEntries.date });
  for (const d of new Set(rows.map((r) => r.date))) await recomputeDay(db, personId, d);
  return rows.length;
}

/** Copy a meal (or a whole day when mealSlot is omitted) to another date/slot. */
export async function copyMeal(db: Database, input: { personId: string; userId: string; fromDate: string; toDate: string; fromSlot?: string; toSlot?: string }) {
  const src = await db.select().from(diaryEntries).where(and(eq(diaryEntries.personId, input.personId), eq(diaryEntries.date, input.fromDate), input.fromSlot ? eq(diaryEntries.mealSlot, input.fromSlot) : undefined));
  if (!src.length) return [];
  const rows = await db
    .insert(diaryEntries)
    .values(src.map(({ id: _id, createdAt: _c, updatedAt: _u, clientId: _cl, eatenAt: _e, ...e }) => ({ ...e, date: input.toDate, mealSlot: input.toSlot ?? e.mealSlot, origin: "manual", createdBy: input.userId, aiEstimateId: null })))
    .returning();
  await recomputeDay(db, input.personId, input.toDate);
  return rows;
}

/**
 * Undo an AI action: inserts are deleted, updates/deletes restore the `before` rows.
 * Only the user who triggered it can undo, once.
 */
export async function undoAiAction(db: Database, userId: string, actionId: string) {
  const [a] = await db.select().from(aiActions).where(and(eq(aiActions.id, actionId), eq(aiActions.userId, userId), isNull(aiActions.undoneAt))).limit(1);
  if (!a) return false;
  if (a.tableName !== "diary_entries") throw new Error(`Deshacer no soportado para ${a.tableName}`);
  const dates = new Set<string>();
  if (a.action === "insert") {
    const rows = await db.delete(diaryEntries).where(inArray(diaryEntries.id, a.rowIds)).returning({ date: diaryEntries.date });
    rows.forEach((r) => dates.add(r.date));
  } else {
    const before = a.before as (typeof diaryEntries.$inferInsert)[];
    for (const row of before) {
      await db.insert(diaryEntries).values(row).onConflictDoUpdate({ target: diaryEntries.id, set: row });
      dates.add(row.date);
    }
  }
  await db.update(aiActions).set({ undoneAt: new Date() }).where(eq(aiActions.id, a.id));
  if (a.estimateId) await db.update(aiEstimates).set({ status: "discarded" }).where(eq(aiEstimates.id, a.estimateId));
  if (a.personId) for (const d of dates) await recomputeDay(db, a.personId, d);
  return true;
}
