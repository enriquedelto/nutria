/** Best time to train within the gym's hours, from the person's sleep, caffeine habits and weight. */
import { and, diaryEntries, eq, gte, isNotNull, persons, type Database } from "@nutria/db";
import { addDays, bestTrainingTimes, clockToMinutes, medianTime, parseWindow, todayIn, type TrainingTimePlan } from "@nutria/nutrition";
import { caffeinePrefs, usualBedtime, usualWakeTime } from "./caffeine";
import { getSportProfile } from "./sport";
import { latestWeight } from "./targets";
import { usualTrainingTime } from "./timing";

const local = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

export interface TrainingTimeContext {
  gymHours: { from: string; to: string }[];
  durationMin: number;
  wake: number;
  wakeSource: "sleep" | "default";
  bedtime: number;
  bedtimeSource: "manual" | "sleep" | "default";
  halfLifeH: number;
  weightKg: number | null;
  /** Usual morning caffeine (median of the last 14 days with timed caffeine before 13:00). */
  morningCaffeine: { at: number; mg: number } | null;
  /** Usual training start, if any (to compare with the suggestion). */
  usualStart: number | null;
  plan: TrainingTimePlan | null;
}

export async function trainingTimeContext(db: Database, personId: string, now = new Date()): Promise<TrainingTimeContext> {
  const [p] = await db.select({ tz: persons.timezone, settings: persons.settings, pregnancy: persons.pregnancy }).from(persons).where(eq(persons.id, personId)).limit(1);
  const tz = p?.tz ?? "Europe/Madrid";
  const today = todayIn(tz, now);
  const [sport, weight, bed, wake, usual, coffee] = await Promise.all([
    getSportProfile(db, personId),
    latestWeight(db, personId),
    usualBedtime(db, personId, tz, today),
    usualWakeTime(db, personId, tz, today),
    usualTrainingTime(db, personId, tz, today),
    db
      .select({ date: diaryEntries.date, eatenAt: diaryEntries.eatenAt, nutrients: diaryEntries.nutrients })
      .from(diaryEntries)
      .where(and(eq(diaryEntries.personId, personId), gte(diaryEntries.date, addDays(today, -14)), isNotNull(diaryEntries.eatenAt))),
  ]);
  // Morning caffeine per day: total mg before 13:00 and the time of the first dose.
  const byDay = new Map<string, { mg: number; first: string }>();
  for (const e of coffee) {
    const mg = e.nutrients.caffeine ?? 0;
    if (mg <= 0) continue;
    const t = local(e.eatenAt!, tz);
    if (t >= "13:00") continue;
    const d = byDay.get(e.date);
    byDay.set(e.date, d ? { mg: d.mg + mg, first: t < d.first ? t : d.first } : { mg, first: t });
  }
  const days = [...byDay.values()];
  const mgs = days.map((d) => d.mg).sort((a, b) => a - b);
  const morningCaffeine = days.length >= 3 ? { at: clockToMinutes(medianTime(days.map((d) => d.first))!), mg: Math.round(mgs[Math.floor(mgs.length / 2)]!) } : null;

  const prefs = caffeinePrefs(p ?? null, bed);
  const gymHours = sport.profile.gymHours ?? [];
  const durationMin = usual?.durationMin ?? 60;
  const wakeMin = clockToMinutes(wake ?? "07:30");
  const plan =
    gymHours.length && weight
      ? bestTrainingTimes({ windows: gymHours.map(parseWindow), durationMin, wake: wakeMin, bedtime: prefs.bedtime, weightKg: weight.kg, halfLifeH: prefs.halfLifeH, otherCaffeine: morningCaffeine ? [morningCaffeine] : [] })
      : null;
  return {
    gymHours,
    durationMin,
    wake: wakeMin,
    wakeSource: wake ? "sleep" : "default",
    bedtime: prefs.bedtime,
    bedtimeSource: prefs.bedtimeSource,
    halfLifeH: prefs.halfLifeH,
    weightKg: weight?.kg ?? null,
    morningCaffeine,
    usualStart: usual ? clockToMinutes(usual.time) : null,
    plan,
  };
}
