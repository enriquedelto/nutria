/**
 * Supplement plans (supplement_schedules) and intake tracking. A dose taken is a diary entry with
 * origin "supplement" for the plan's food, so protein powder or vitamin D count in the day totals.
 */
import { and, asc, diaryEntries, eq, foods, gte, inArray, mealSlots, persons, sql, supplementSchedules, type Database } from "@nutria/db";
import { addDays, isoDow, SUPPLEMENT_BY_CODE, todayIn } from "@nutria/nutrition";
import { addEntries } from "./diary";
import { recomputeDay } from "./summaries";

const SOURCE_PREFIX = "sup:";

/** Catalogue code of a food created from the supplement catalogue (sourceId "sup:<code>:<group>"). */
export const supplementCodeOf = (sourceId: string | null | undefined) => (sourceId?.startsWith(SOURCE_PREFIX) ? sourceId.split(":")[1]! : null);

/** Find or create the group's food for a catalogue supplement. */
export async function supplementFood(db: Database, personId: string, userId: string | null, code: string) {
  const info = SUPPLEMENT_BY_CODE[code];
  if (!info) throw new Error("Suplemento desconocido");
  const [p] = await db.select({ groupId: persons.groupId }).from(persons).where(eq(persons.id, personId)).limit(1);
  const sourceId = `${SOURCE_PREFIX}${code}:${p?.groupId ?? personId}`;
  const [found] = await db.select().from(foods).where(and(eq(foods.source, "custom"), eq(foods.sourceId, sourceId))).limit(1);
  if (found) return found;
  const n = info.per100;
  const [f] = await db
    .insert(foods)
    .values({
      source: "custom",
      sourceId,
      kind: "supplement",
      name: info.name,
      nameEs: info.name,
      groupId: p?.groupId ?? null,
      createdBy: userId,
      kcal: n.energy_kcal ?? 0,
      protein: n.protein ?? 0,
      carbs: n.carbs ?? 0,
      sugars: n.sugars ?? 0,
      fat: n.fat ?? 0,
      satFat: n.sat_fat ?? 0,
      fiber: 0,
      salt: 0,
      nutrients: { energy_kcal: 0, protein: 0, carbs: 0, fat: 0, ...n },
      verified: true,
    })
    .onConflictDoNothing()
    .returning();
  if (f) return f;
  const [again] = await db.select().from(foods).where(and(eq(foods.source, "custom"), eq(foods.sourceId, sourceId))).limit(1);
  return again!;
}

export interface SupplementPlanInput {
  code?: string;
  foodId?: string;
  dose: number;
  doseUnit: string;
  gramsPerDose: number;
  times: string[];
  daysOfWeek: number[];
}

export async function addSupplementPlan(db: Database, personId: string, userId: string | null, input: SupplementPlanInput) {
  const foodId = input.foodId ?? (input.code ? (await supplementFood(db, personId, userId, input.code)).id : null);
  if (!foodId) throw new Error("Falta el suplemento");
  const [row] = await db
    .insert(supplementSchedules)
    .values({ personId, foodId, dose: input.dose, doseUnit: input.doseUnit, gramsPerDose: input.gramsPerDose, times: input.times, daysOfWeek: input.daysOfWeek, active: true })
    .returning();
  return row!;
}

export const doseLabel = (dose: number, unit: string) => `${dose.toLocaleString("es-ES")} ${unit}${unit === "cápsula" && dose !== 1 ? "s" : ""}`;

/** Consecutive scheduled days (ending today, or yesterday if today is still pending) with a dose taken. */
export function supplementStreak(takenDates: Set<string>, daysOfWeek: number[], today: string, since?: string) {
  let n = 0;
  let d = takenDates.has(today) ? today : addDays(today, -1);
  for (let i = 0; i < 400; i++, d = addDays(d, -1)) {
    if (since && d < since) break;
    if (!daysOfWeek.includes(isoDow(d))) continue;
    if (!takenDates.has(d)) break;
    n++;
  }
  return n;
}

/** Plans of a person with today's status ("taken" = any diary entry of that food that day). */
export async function supplementsForDate(db: Database, personId: string, date: string, opts: { all?: boolean } = {}) {
  const rows = await db
    .select({ s: supplementSchedules, name: sql<string>`coalesce(${foods.nameEs}, ${foods.name})`, brand: foods.brand, sourceId: foods.sourceId, kcal: foods.kcal, protein: foods.protein })
    .from(supplementSchedules)
    .innerJoin(foods, eq(foods.id, supplementSchedules.foodId))
    .where(and(eq(supplementSchedules.personId, personId), opts.all ? undefined : eq(supplementSchedules.active, true)))
    .orderBy(asc(supplementSchedules.createdAt));
  if (!rows.length) return [];
  const foodIds = [...new Set(rows.map((r) => r.s.foodId))];
  const history = await db
    .select({ foodId: diaryEntries.foodId, date: diaryEntries.date, id: diaryEntries.id, origin: diaryEntries.origin })
    .from(diaryEntries)
    .where(and(eq(diaryEntries.personId, personId), inArray(diaryEntries.foodId, foodIds), gte(diaryEntries.date, addDays(date, -400))));
  const dow = isoDow(date);
  return rows.map(({ s, name, brand, sourceId, kcal, protein }) => {
    const mine = history.filter((h) => h.foodId === s.foodId);
    const dates = new Set(mine.map((h) => h.date));
    const todayEntry = mine.find((h) => h.date === date);
    const code = supplementCodeOf(sourceId);
    return {
      id: s.id,
      foodId: s.foodId,
      code,
      name,
      brand,
      dose: s.dose,
      doseUnit: s.doseUnit,
      doseLabel: doseLabel(s.dose, s.doseUnit),
      gramsPerDose: s.gramsPerDose,
      times: s.times.map((t) => t.slice(0, 5)),
      daysOfWeek: s.daysOfWeek,
      active: s.active,
      scheduledToday: s.daysOfWeek.includes(dow),
      taken: !!todayEntry,
      entryId: todayEntry?.id ?? null,
      streak: supplementStreak(dates, s.daysOfWeek, date, s.createdAt.toISOString().slice(0, 10)),
      kcalPerDose: Math.round(((kcal ?? 0) * s.gramsPerDose) / 100),
      proteinPerDose: Math.round(((protein ?? 0) * s.gramsPerDose) / 10) / 10,
    };
  });
}

export type SupplementStatus = Awaited<ReturnType<typeof supplementsForDate>>[number];

/** Meal slot whose default time is closest to `hhmm` (fallback: first slot, then "snack"). */
async function slotNear(db: Database, personId: string, hhmm: string) {
  const slots = await db.select({ key: mealSlots.key, t: mealSlots.defaultTime }).from(mealSlots).where(eq(mealSlots.personId, personId)).orderBy(asc(mealSlots.sortOrder));
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const target = mins(hhmm);
  const timed = slots.filter((s) => s.t);
  if (!timed.length) return slots[0]?.key ?? "snack";
  return timed.reduce((best, s) => (Math.abs(mins(s.t!) - target) < Math.abs(mins(best.t!) - target) ? s : best)).key;
}

/** Log a dose of a plan in the diary (idempotent per plan and day). */
export async function takeSupplement(db: Database, personId: string, userId: string, scheduleId: string, date?: string) {
  const [s] = await db.select().from(supplementSchedules).where(and(eq(supplementSchedules.id, scheduleId), eq(supplementSchedules.personId, personId))).limit(1);
  if (!s) throw new Error("Pauta no encontrada");
  const [p] = await db.select({ tz: persons.timezone }).from(persons).where(eq(persons.id, personId)).limit(1);
  const tz = p?.tz ?? "Europe/Madrid";
  const day = date ?? todayIn(tz);
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const mealSlot = await slotNear(db, personId, s.times[0]?.slice(0, 5) ?? now);
  const [row] = await addEntries(db, {
    personId,
    userId,
    date: day,
    mealSlot,
    origin: "supplement",
    items: [{ foodId: s.foodId, grams: s.gramsPerDose, servingLabel: doseLabel(s.dose, s.doseUnit), servingQty: 1, eatenAt: day === todayIn(tz) ? new Date() : null, clientId: `sup-${s.id}-${day}` }],
  });
  return row ?? null;
}

/** Undo today's dose: removes the plan's diary entries of that food on that day. */
export async function untakeSupplement(db: Database, personId: string, scheduleId: string, date: string) {
  const [s] = await db.select({ foodId: supplementSchedules.foodId }).from(supplementSchedules).where(and(eq(supplementSchedules.id, scheduleId), eq(supplementSchedules.personId, personId))).limit(1);
  if (!s) return 0;
  const gone = await db
    .delete(diaryEntries)
    .where(and(eq(diaryEntries.personId, personId), eq(diaryEntries.date, date), eq(diaryEntries.foodId, s.foodId), eq(diaryEntries.origin, "supplement")))
    .returning({ id: diaryEntries.id });
  await recomputeDay(db, personId, date);
  return gone.length;
}

/** Whether a plan's food is already in the diary on a date (used by reminders). */
export async function supplementTakenOn(db: Database, personId: string, foodId: string, date: string) {
  const [r] = await db.select({ id: diaryEntries.id }).from(diaryEntries).where(and(eq(diaryEntries.personId, personId), eq(diaryEntries.foodId, foodId), eq(diaryEntries.date, date))).limit(1);
  return !!r;
}
