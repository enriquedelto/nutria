/** Meals around training: the day's session and meals, and the history for the personal analysis. */
import { and, asc, diaryEntries, eq, exerciseLogs, gte, isNotNull, mealSlots, persons, type Database } from "@nutria/db";
import { addDays, clockToMinutes, groupMeals, isoDow, todayIn, workoutExercises, type GroupedMeal, type SessionInput, type TimedMeal } from "@nutria/nutrition";
import { entryMinute } from "./caffeine";
import { dayKindFor, getSportProfile } from "./sport";
import { latestWeight } from "./targets";
import { usualTrainingTime } from "./timing";

const clock = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

export interface TrainingDayMeals {
  /** Minutes from 00:00 of the day. null on rest days. */
  session: { start: number; end: number; source: "logged" | "usual" | "default"; name: string | null } | null;
  meals: GroupedMeal[];
  weightKg: number | null;
}

/** The day's training session (logged, else the usual one on planned days) and its meals with times. */
export async function trainingDayMeals(db: Database, personId: string, date: string, now = new Date()): Promise<TrainingDayMeals> {
  const [p] = await db.select({ tz: persons.timezone }).from(persons).where(eq(persons.id, personId)).limit(1);
  const tz = p?.tz ?? "Europe/Madrid";
  const today = todayIn(tz, now);
  const [entries, slots, sport, logged, weight] = await Promise.all([
    db
      .select({ name: diaryEntries.name, date: diaryEntries.date, mealSlot: diaryEntries.mealSlot, carbs: diaryEntries.carbs, protein: diaryEntries.protein, kcal: diaryEntries.kcal, eatenAt: diaryEntries.eatenAt, createdAt: diaryEntries.createdAt, origin: diaryEntries.origin })
      .from(diaryEntries)
      .where(and(eq(diaryEntries.personId, personId), eq(diaryEntries.date, date))),
    db.select({ key: mealSlots.key, time: mealSlots.defaultTime }).from(mealSlots).where(eq(mealSlots.personId, personId)),
    getSportProfile(db, personId),
    db.select({ startedAt: exerciseLogs.startedAt, min: exerciseLogs.durationMin, name: exerciseLogs.name }).from(exerciseLogs).where(and(eq(exerciseLogs.personId, personId), eq(exerciseLogs.date, date))).orderBy(asc(exerciseLogs.startedAt)),
    latestWeight(db, personId),
  ]);
  const slotTime = new Map(slots.map((s) => [s.key, s.time]));
  const meals = groupMeals(
    entries
      .filter((e) => e.origin !== "supplement" || e.kcal > 0)
      .map((e) => {
        const t = entryMinute(e, slotTime.get(e.mealSlot), tz, date);
        return { at: t.at, approx: t.source !== "eaten", carbs: e.carbs, protein: e.protein, kcal: e.kcal, name: e.name, slot: e.mealSlot };
      }),
  );

  let session: TrainingDayMeals["session"] = null;
  const real = logged.find((l) => l.startedAt);
  if (real) {
    const start = clockToMinutes(clock(real.startedAt!, tz));
    session = { start, end: start + Math.max(20, real.min || 60), source: "logged", name: real.name };
  } else if (dayKindFor(date, today, logged.length > 0, sport.profile) === "training") {
    const usual = await usualTrainingTime(db, personId, tz, today, isoDow(date));
    const start = clockToMinutes(usual?.time ?? "18:30");
    session = { start, end: start + (usual?.durationMin ?? 60), source: usual ? "usual" : "default", name: null };
  }
  return { session, meals, weightKg: weight?.kg ?? null };
}

export interface TrainingMealHistory {
  /** Times in minutes since the epoch. Oldest first; includes 8 weeks before the window as baseline. */
  sessions: SessionInput[];
  /** Only meals with a real time (eaten_at). */
  meals: TimedMeal[];
  weightKg: number | null;
}

/** Workouts and timed meals of the last `weeks` weeks (plus 8 weeks of workouts as strength baseline). */
export async function trainingMealHistory(db: Database, personId: string, weeks = 12, now = new Date()): Promise<TrainingMealHistory> {
  const [p] = await db.select({ tz: persons.timezone }).from(persons).where(eq(persons.id, personId)).limit(1);
  const today = todayIn(p?.tz ?? "Europe/Madrid", now);
  const from = addDays(today, -weeks * 7);
  const [logs, entries, weight] = await Promise.all([
    db
      .select({ startedAt: exerciseLogs.startedAt, min: exerciseLogs.durationMin, details: exerciseLogs.details })
      .from(exerciseLogs)
      .where(and(eq(exerciseLogs.personId, personId), gte(exerciseLogs.date, addDays(from, -56)), isNotNull(exerciseLogs.startedAt)))
      .orderBy(asc(exerciseLogs.startedAt)),
    db
      .select({ name: diaryEntries.name, mealSlot: diaryEntries.mealSlot, carbs: diaryEntries.carbs, protein: diaryEntries.protein, kcal: diaryEntries.kcal, eatenAt: diaryEntries.eatenAt })
      .from(diaryEntries)
      .where(and(eq(diaryEntries.personId, personId), gte(diaryEntries.date, addDays(from, -1)), isNotNull(diaryEntries.eatenAt))),
    latestWeight(db, personId),
  ]);
  const min = (d: Date) => Math.round(d.getTime() / 60_000);
  return {
    sessions: logs.map((l) => ({ start: min(l.startedAt!), durationMin: l.min || 60, exercises: workoutExercises(l.details) })),
    meals: groupMeals(entries.map((e) => ({ at: min(e.eatenAt!), carbs: e.carbs, protein: e.protein, kcal: e.kcal, name: e.name, slot: e.mealSlot }))),
    weightKg: weight?.kg ?? null,
  };
}
