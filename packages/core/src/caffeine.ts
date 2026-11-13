/** Data for the caffeine curve of a day: doses with their time, training start and bedtime. */
import { and, diaryEntries, eq, exerciseLogs, gte, inArray, isNotNull, lte, mealSlots, persons, sleepLogs, type Database } from "@nutria/db";
import {
  addDays,
  CAFFEINE_DEFAULT_HALF_LIFE_H,
  CAFFEINE_PREGNANCY_HALF_LIFE_H,
  clockToMinutes,
  isoDow,
  medianTime,
  minutesToClock,
  todayIn,
  type CaffeineDose,
} from "@nutria/nutrition";
import { dayKindFor, getSportProfile } from "./sport";
import { latestWeight } from "./targets";
import { usualTrainingTime } from "./timing";

const local = (d: Date, timeZone: string) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
};
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
/** Bedtimes after midnight belong to the evening before: 00:30 → 24:30. */
const bedMinutes = (hhmm: string) => {
  const m = clockToMinutes(hhmm);
  return m < 12 * 60 ? m + 1440 : m;
};

/** Usual bedtime (median of the last 30 nights), handling times after midnight. */
export async function usualBedtime(db: Database, personId: string, timeZone: string, today: string): Promise<string | null> {
  const rows = await db
    .select({ bedtime: sleepLogs.bedtime })
    .from(sleepLogs)
    .where(and(eq(sleepLogs.personId, personId), gte(sleepLogs.date, addDays(today, -30)), lte(sleepLogs.date, today), isNotNull(sleepLogs.bedtime)));
  if (!rows.length) return null;
  // Shift to minutes from noon so 23:30 and 00:30 sit next to each other, then back.
  const shifted = rows.map((r) => minutesToClock(bedMinutes(local(r.bedtime!, timeZone).time) - 720));
  const med = medianTime(shifted);
  return med ? minutesToClock(clockToMinutes(med) + 720) : null;
}

export interface CaffeineDoseRow extends CaffeineDose {
  id: string;
  name: string;
  date: string;
  /** Where the time comes from: logged time, meal's usual time or when it was registered. */
  timeSource: "eaten" | "slot" | "created";
}

export interface CaffeineDay {
  date: string;
  doses: CaffeineDoseRow[];
  /** Training start (minutes) on training days, else null. */
  trainingStart: number | null;
  /** "logged" = today's workout, "usual" = median of past workouts, "default" = 18:30. */
  trainingSource: "logged" | "usual" | "default" | null;
  /** Minutes from 00:00 of `date` (after midnight → > 1440). */
  bedtime: number;
  bedtimeSource: "manual" | "sleep" | "default";
  halfLifeH: number;
  halfLifeSource: "manual" | "pregnancy" | "default";
  weightKg: number | null;
}

export async function caffeineDay(db: Database, personId: string, date: string, now = new Date()): Promise<CaffeineDay> {
  const [p] = await db.select({ tz: persons.timezone, settings: persons.settings, pregnancy: persons.pregnancy }).from(persons).where(eq(persons.id, personId)).limit(1);
  const tz = p?.tz ?? "Europe/Madrid";
  const today = todayIn(tz, now);
  const prev = addDays(date, -1);
  const [entries, slots, sport, logged, weight, bedUsual] = await Promise.all([
    db
      .select({ id: diaryEntries.id, name: diaryEntries.name, date: diaryEntries.date, mealSlot: diaryEntries.mealSlot, nutrients: diaryEntries.nutrients, eatenAt: diaryEntries.eatenAt, createdAt: diaryEntries.createdAt })
      .from(diaryEntries)
      .where(and(eq(diaryEntries.personId, personId), inArray(diaryEntries.date, [prev, date]))),
    db.select({ key: mealSlots.key, time: mealSlots.defaultTime }).from(mealSlots).where(eq(mealSlots.personId, personId)),
    getSportProfile(db, personId),
    db.select({ startedAt: exerciseLogs.startedAt }).from(exerciseLogs).where(and(eq(exerciseLogs.personId, personId), eq(exerciseLogs.date, date))),
    latestWeight(db, personId),
    usualBedtime(db, personId, tz, today),
  ]);
  const slotTime = new Map(slots.map((s) => [s.key, s.time]));
  const doses: CaffeineDoseRow[] = [];
  for (const e of entries) {
    const mg = e.nutrients.caffeine ?? 0;
    if (mg <= 0) continue;
    let at: number;
    let timeSource: CaffeineDoseRow["timeSource"];
    const slot = slotTime.get(e.mealSlot);
    if (e.eatenAt) {
      const l = local(e.eatenAt, tz);
      at = daysBetween(date, l.date) * 1440 + clockToMinutes(l.time);
      timeSource = "eaten";
    } else if (slot) {
      at = daysBetween(date, e.date) * 1440 + clockToMinutes(slot);
      timeSource = "slot";
    } else {
      const l = local(e.createdAt, tz);
      at = daysBetween(date, e.date) * 1440 + clockToMinutes(l.date === e.date ? l.time : "12:00");
      timeSource = "created";
    }
    // From the day before only the afternoon/evening still matters.
    if (at < -12 * 60) continue;
    doses.push({ id: e.id, name: e.name, date: e.date, at, mg: Math.round(mg), timeSource });
  }
  doses.sort((a, b) => a.at - b.at);

  const real = logged.find((l) => l.startedAt);
  const training = dayKindFor(date, today, logged.length > 0, sport.profile) === "training";
  let trainingStart: number | null = null;
  let trainingSource: CaffeineDay["trainingSource"] = null;
  if (real) {
    trainingStart = clockToMinutes(local(real.startedAt!, tz).time);
    trainingSource = "logged";
  } else if (training) {
    const usual = await usualTrainingTime(db, personId, tz, today, isoDow(date));
    trainingStart = clockToMinutes(usual?.time ?? "18:30");
    trainingSource = usual ? "usual" : "default";
  }

  const manualBed = p?.settings?.caffeine?.bedtime;
  const manualHalf = p?.settings?.caffeine?.halfLifeH;
  return {
    date,
    doses,
    trainingStart,
    trainingSource,
    bedtime: bedMinutes(manualBed ?? bedUsual ?? "23:30"),
    bedtimeSource: manualBed ? "manual" : bedUsual ? "sleep" : "default",
    halfLifeH: manualHalf ?? (p?.pregnancy ? CAFFEINE_PREGNANCY_HALF_LIFE_H : CAFFEINE_DEFAULT_HALF_LIFE_H),
    halfLifeSource: manualHalf ? "manual" : p?.pregnancy ? "pregnancy" : "default",
    weightKg: weight?.kg ?? null,
  };
}
