/** Nutrient timing around training: usual training time, the plan for today and quick protein ideas. */
import { and, dailySummaries, desc, diaryEntries, eq, exerciseLogs, gte, isNotNull, persons, sql, type Database } from "@nutria/db";
import { addDays, isoDow, medianTime, proteinDoseG, timingPhase, todayIn, trainingTiming, type TimingPhase, type TrainingTiming } from "@nutria/nutrition";
import { notify, QUICK_ACTIONS } from "./notify";
import { dayKindFor, getSportProfile } from "./sport";
import { latestWeight } from "./targets";

const clock = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

/**
 * Usual training start (median of the last 8 weeks), preferring sessions on the same weekday
 * when there are at least two. Null without timed workouts.
 */
export async function usualTrainingTime(db: Database, personId: string, timeZone: string, today: string, dow?: number) {
  const rows = await db
    .select({ date: exerciseLogs.date, startedAt: exerciseLogs.startedAt, min: exerciseLogs.durationMin })
    .from(exerciseLogs)
    .where(and(eq(exerciseLogs.personId, personId), gte(exerciseLogs.date, addDays(today, -56)), isNotNull(exerciseLogs.startedAt)));
  if (!rows.length) return null;
  const sameDay = dow == null ? [] : rows.filter((r) => isoDow(r.date) === dow);
  const use = sameDay.length >= 2 ? sameDay : rows;
  const mins = use.map((r) => r.min).filter((m) => m > 0).sort((a, b) => a - b);
  return { time: medianTime(use.map((r) => clock(r.startedAt!, timeZone)))!, durationMin: mins.length ? Math.round(mins[Math.floor(mins.length / 2)]!) : 60, samples: use.length };
}

export interface ProteinIdea {
  foodId: string;
  name: string;
  grams: number;
  protein: number;
}

/** Protein-rich foods the person actually eats (at least 25 % of kcal from protein), with the usual amount. */
export async function proteinIdeas(db: Database, personId: string, today: string, limit = 3): Promise<ProteinIdea[]> {
  const rows = await db
    .select({
      foodId: diaryEntries.foodId,
      name: sql<string>`(array_agg(${diaryEntries.name} order by ${diaryEntries.createdAt} desc))[1]`,
      grams: sql<number>`avg(${diaryEntries.grams})::float`,
      protein: sql<number>`avg(${diaryEntries.protein})::float`,
    })
    .from(diaryEntries)
    .where(and(eq(diaryEntries.personId, personId), gte(diaryEntries.date, addDays(today, -90)), isNotNull(diaryEntries.foodId)))
    .groupBy(diaryEntries.foodId)
    .having(sql`avg(${diaryEntries.protein}) >= 10 and sum(${diaryEntries.protein}) * 4 >= 0.25 * nullif(sum(${diaryEntries.kcal}), 0)`)
    .orderBy(desc(sql`count(*)`), desc(sql`avg(${diaryEntries.protein})`))
    .limit(limit);
  return rows.map((r) => ({ foodId: r.foodId!, name: r.name, grams: Math.round(r.grams), protein: Math.round(r.protein) }));
}

export interface TrainingDayPlan {
  timing: TrainingTiming;
  phase: TimingPhase;
  /** The workout is already logged today. */
  done: boolean;
  /** The start is the real one (logged) or the usual one; false = no history, default 18:30. */
  known: boolean;
  proteinDoseG: number;
  ideas: ProteinIdea[];
}

/** Timing card for today: null on rest days or without weight. */
export async function trainingDayPlan(db: Database, personId: string, now = new Date()): Promise<TrainingDayPlan | null> {
  const [p] = await db.select({ tz: persons.timezone }).from(persons).where(eq(persons.id, personId)).limit(1);
  if (!p) return null;
  const today = todayIn(p.tz, now);
  const [sport, w, logged] = await Promise.all([
    getSportProfile(db, personId),
    latestWeight(db, personId),
    db.select({ startedAt: exerciseLogs.startedAt, min: exerciseLogs.durationMin }).from(exerciseLogs).where(and(eq(exerciseLogs.personId, personId), eq(exerciseLogs.date, today))).orderBy(desc(exerciseLogs.startedAt)),
  ]);
  if (!w) return null;
  if (dayKindFor(today, today, logged.length > 0, sport.profile) !== "training") return null;
  const real = logged.find((l) => l.startedAt);
  const usual = real ? null : await usualTrainingTime(db, personId, p.tz, today, isoDow(today));
  const timing = real ? trainingTiming(clock(real.startedAt!, p.tz), real.min || 60, w.kg) : trainingTiming(usual?.time ?? "18:30", usual?.durationMin ?? 60, w.kg);
  let phase = timingPhase(timing, clock(now, p.tz));
  // Logged without a time, or logged while the clock says "during": the session is over.
  if (logged.length && (!real || phase === "during" || phase === "soon" || phase === "pre" || phase === "early")) phase = "post";
  return { timing, phase, done: logged.length > 0, known: !!real || !!usual, proteinDoseG: proteinDoseG(w.kg), ideas: await proteinIdeas(db, personId, today) };
}

/** Protein eaten on a day (from the cached summary). */
export async function proteinToday(db: Database, personId: string, date: string) {
  const [d] = await db.select({ protein: dailySummaries.protein, entries: dailySummaries.entries }).from(dailySummaries).where(and(eq(dailySummaries.personId, personId), eq(dailySummaries.date, date))).limit(1);
  return { protein: d?.protein ?? 0, entries: d?.entries ?? 0 };
}

/** A workout that has just finished (3 h ago at most) arrives from openGym: remind the post-workout protein. */
export async function notifyPostWorkout(db: Database, personId: string, fresh: { startedAt: Date | null; durationMin: number }[], weightKg: number | null, now = new Date()) {
  const recent = fresh.find((e) => {
    if (!e.startedAt) return false;
    const end = e.startedAt.getTime() + e.durationMin * 60_000;
    return end <= now.getTime() + 5 * 60_000 && now.getTime() - end <= 3 * 3_600_000;
  });
  if (!recent) return false;
  const [p] = await db.select({ userId: persons.userId, timezone: persons.timezone }).from(persons).where(eq(persons.id, personId)).limit(1);
  if (!p?.userId) return false;
  const grams = weightKg ? `${Math.round(0.3 * weightKg)}–${Math.round(0.4 * weightKg)} g` : "25–35 g";
  await notify(db, { userId: p.userId, type: "post_workout", title: "💪 Entreno registrado. ¿Tu batido?", body: `${grams} de proteína con hidratos en las próximas 2 h.`, url: "/hoy#entreno", tag: "post-workout", timezone: p.timezone, actions: [QUICK_ACTIONS.shake] });
  return true;
}
