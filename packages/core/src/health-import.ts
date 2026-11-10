/**
 * Inbound health data from a phone/watch (POST /api/hooks/health): steps, sleep, heart rate,
 * weight and exercise. Accepts the JSON of the «Health Connect Webhook» Android app (arrays of
 * records with snake_case fields) and a simpler camelCase shape; unknown fields are ignored.
 * Re-sending the same or overlapping data never duplicates (per-day upserts and external ids).
 */
import { and, eq, exerciseLogs, heartRateDaily, sleepLogs, sql, stepLogs, weightLogs, type Database } from "@nutria/db";
import { stepsKcal, todayIn } from "@nutria/nutrition";
import { recomputeDay } from "./summaries";
import { latestWeight, recomputeTargets } from "./targets";

type Rec = Record<string, unknown>;
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Rec[]) : []);
const num = (r: Rec, ...keys: string[]) => {
  for (const k of keys) {
    const v = typeof r[k] === "string" ? Number(r[k]) : r[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
};
const time = (r: Rec, ...keys: string[]) => {
  for (const k of keys) {
    const v = r[k];
    const d = typeof v === "number" ? new Date(v > 1e11 ? v : v * 1000) : typeof v === "string" ? new Date(v) : null;
    if (d && !Number.isNaN(d.getTime()) && d.getFullYear() > 2000) return d;
  }
  return null;
};
const str = (r: Rec, ...keys: string[]) => {
  for (const k of keys) if (typeof r[k] === "string" && r[k]) return r[k] as string;
  return null;
};

export interface HealthData {
  steps: { date: string; steps: number }[];
  sleep: { date: string; bedtime: Date | null; wakeTime: Date | null; hours: number }[];
  heart: { date: string; min: number | null; avg: number | null; max: number | null; resting: number | null; samples: number }[];
  weights: { at: Date; date: string; kg: number; bodyFatPct: number | null; id: string }[];
  exercise: { start: Date; date: string; minutes: number; name: string; kcal: number | null; id: string }[];
}

const EXERCISE_NAMES: Record<string, string> = { walking: "Caminar", running: "Correr", biking: "Bicicleta", cycling: "Bicicleta", swimming: "Natación", hiking: "Senderismo", strength_training: "Fuerza", weightlifting: "Fuerza", yoga: "Yoga", football: "Fútbol", soccer: "Fútbol", padel: "Pádel", tennis: "Tenis" };

/** Normalise a payload into per-day facts in the person's time zone. */
export function parseHealthPayload(body: unknown, timeZone: string): HealthData {
  const b = (body && typeof body === "object" ? body : {}) as Rec;
  const day = (d: Date) => todayIn(timeZone, d);

  const steps = new Map<string, number>();
  if (typeof b.steps === "number" && b.steps >= 0) steps.set(typeof b.date === "string" ? b.date : day(new Date()), Math.round(b.steps));
  for (const r of arr(b.steps)) {
    const n = num(r, "count", "steps", "value");
    const at = time(r, "start_time", "startTime", "start", "time", "date");
    const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : at ? day(at) : null;
    if (n == null || n < 0 || !date) continue;
    steps.set(date, (steps.get(date) ?? 0) + Math.round(n));
  }

  const sleep = new Map<string, HealthData["sleep"][number]>();
  for (const r of arr(b.sleep)) {
    const end = time(r, "session_end_time", "end_time", "endTime", "end", "wakeTime");
    let start = time(r, "session_start_time", "start_time", "startTime", "start", "bedtime");
    const secs = num(r, "duration_seconds", "durationSeconds");
    const hours = num(r, "hours") ?? (secs != null ? secs / 3600 : start && end ? (end.getTime() - start.getTime()) / 3_600_000 : null);
    if (!end || hours == null || hours < 0.5 || hours > 20) continue;
    start ??= new Date(end.getTime() - hours * 3_600_000);
    const date = day(end);
    const prev = sleep.get(date);
    if (!prev || hours > prev.hours) sleep.set(date, { date, bedtime: start, wakeTime: end, hours: Math.round(hours * 100) / 100 });
  }

  const hr = new Map<string, { min: number; max: number; sum: number; n: number; resting: number | null }>();
  const bump = (date: string) => hr.get(date) ?? hr.set(date, { min: Infinity, max: 0, sum: 0, n: 0, resting: null }).get(date)!;
  for (const r of [...arr(b.heart_rate), ...arr(b.heartRate)]) {
    const at = time(r, "time", "start_time", "startTime", "date");
    const bpm = num(r, "bpm", "beats_per_minute", "value", "avg");
    if (!at || bpm == null || bpm < 25 || bpm > 250) continue;
    const d = bump(day(at));
    const lo = num(r, "min") ?? bpm;
    const hi = num(r, "max") ?? bpm;
    d.min = Math.min(d.min, lo);
    d.max = Math.max(d.max, hi);
    d.sum += bpm;
    d.n++;
  }
  for (const r of [...arr(b.resting_heart_rate), ...arr(b.restingHeartRate)]) {
    const at = time(r, "time", "start_time", "date");
    const bpm = num(r, "bpm", "beats_per_minute", "value");
    if (!at || bpm == null || bpm < 25 || bpm > 150) continue;
    const d = bump(day(at));
    d.resting = d.resting == null ? bpm : Math.min(d.resting, bpm);
  }

  const weights: HealthData["weights"] = [];
  for (const r of arr(b.weight)) {
    const at = time(r, "time", "start_time", "date") ?? new Date();
    const g = num(r, "grams");
    const kg = num(r, "kilograms", "kg", "weight", "value") ?? (g != null ? g / 1000 : null);
    if (kg == null || kg < 2 || kg > 400) continue;
    weights.push({ at, date: day(at), kg: Math.round(kg * 100) / 100, bodyFatPct: num(r, "body_fat_pct", "bodyFatPct"), id: str(r, "id", "uid") ?? `hc:${at.toISOString()}` });
  }

  const exercise: HealthData["exercise"] = [];
  for (const r of [...arr(b.exercise), ...arr(b.exercise_sessions), ...arr(b.workouts)]) {
    const start = time(r, "start_time", "startTime", "start");
    const end = time(r, "end_time", "endTime", "end");
    const secs = num(r, "duration_seconds", "durationSeconds");
    const minutes = num(r, "minutes") ?? (secs != null ? secs / 60 : start && end ? (end.getTime() - start.getTime()) / 60_000 : null);
    if (!start || minutes == null || minutes < 3 || minutes > 1440) continue;
    const type = (str(r, "type", "exercise_type", "exerciseType", "activity") ?? "").toLowerCase().replace(/^exercise_type_/, "");
    exercise.push({ start, date: day(start), minutes: Math.round(minutes), name: str(r, "title", "name") ?? EXERCISE_NAMES[type] ?? (type ? type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Ejercicio"), kcal: num(r, "kcal", "calories", "active_calories", "energy_kcal"), id: str(r, "id", "uid") ?? `hc:${start.toISOString()}` });
  }

  return {
    steps: [...steps].map(([date, n]) => ({ date, steps: n })),
    sleep: [...sleep.values()],
    heart: [...hr].map(([date, d]) => ({ date, min: d.n ? Math.round(d.min) : null, avg: d.n ? Math.round((d.sum / d.n) * 10) / 10 : null, max: d.n ? Math.round(d.max) : null, resting: d.resting == null ? null : Math.round(d.resting), samples: d.n })),
    weights,
    exercise,
  };
}

/** Store the parsed data. Returns what changed. */
export async function importHealthData(db: Database, personId: string, data: HealthData) {
  const w = (await latestWeight(db, personId))?.kg ?? 70;
  const dates = new Set<string>();

  for (const s of data.steps) {
    // The sender repeats partial days: keep the highest count seen.
    await db
      .insert(stepLogs)
      .values({ personId, date: s.date, steps: s.steps, kcal: stepsKcal(s.steps, w) })
      .onConflictDoUpdate({ target: [stepLogs.personId, stepLogs.date], set: { steps: sql`greatest(${stepLogs.steps}, excluded.steps)`, kcal: sql`greatest(coalesce(${stepLogs.kcal}, 0), excluded.kcal)`, updatedAt: new Date() } });
    dates.add(s.date);
  }
  for (const s of data.sleep) {
    // Keeps a manual note/quality; the longest session of the night wins.
    await db
      .insert(sleepLogs)
      .values({ personId, date: s.date, bedtime: s.bedtime, wakeTime: s.wakeTime, hours: s.hours })
      .onConflictDoUpdate({ target: [sleepLogs.personId, sleepLogs.date], set: { bedtime: sql`excluded.bedtime`, wakeTime: sql`excluded.wake_time`, hours: sql`excluded.hours`, updatedAt: new Date() }, setWhere: sql`excluded.hours >= ${sleepLogs.hours}` });
  }
  for (const h of data.heart) {
    await db
      .insert(heartRateDaily)
      .values({ personId, date: h.date, minBpm: h.min, avgBpm: h.avg, maxBpm: h.max, restingBpm: h.resting, samples: h.samples })
      .onConflictDoUpdate({
        target: [heartRateDaily.personId, heartRateDaily.date],
        set: {
          minBpm: sql`least(${heartRateDaily.minBpm}, excluded.min_bpm)`,
          maxBpm: sql`greatest(${heartRateDaily.maxBpm}, excluded.max_bpm)`,
          // The fuller batch of the day gives the average (batches overlap, so they are not added up).
          avgBpm: sql`case when excluded.samples >= ${heartRateDaily.samples} then coalesce(excluded.avg_bpm, ${heartRateDaily.avgBpm}) else ${heartRateDaily.avgBpm} end`,
          samples: sql`greatest(${heartRateDaily.samples}, excluded.samples)`,
          restingBpm: sql`least(${heartRateDaily.restingBpm}, excluded.resting_bpm)`,
          updatedAt: new Date(),
        },
      });
  }
  let weights = 0;
  for (const x of data.weights) {
    const rows = await db.insert(weightLogs).values({ personId, date: x.date, measuredAt: x.at, kg: x.kg, bodyFatPct: x.bodyFatPct, source: "health", externalId: x.id }).onConflictDoNothing().returning({ id: weightLogs.id });
    weights += rows.length;
  }
  if (weights) await recomputeTargets(db, personId).catch(() => undefined);

  let exercise = 0;
  for (const e of data.exercise) {
    // openGym already brings the gym sessions of that day with their sets: do not count them twice.
    const [gym] = await db.select({ id: exerciseLogs.id }).from(exerciseLogs).where(and(eq(exerciseLogs.personId, personId), eq(exerciseLogs.date, e.date), eq(exerciseLogs.source, "opengym"))).limit(1);
    if (gym) continue;
    const kcal = e.kcal ?? Math.round(5 * w * (e.minutes / 60));
    const rows = await db
      .insert(exerciseLogs)
      .values({ personId, date: e.date, startedAt: e.start, name: e.name, durationMin: e.minutes, kcal, source: "health", externalId: e.id })
      .onConflictDoUpdate({ target: [exerciseLogs.personId, exerciseLogs.source, exerciseLogs.externalId], targetWhere: sql`${exerciseLogs.externalId} is not null`, set: { durationMin: sql`excluded.duration_min`, kcal: sql`excluded.kcal`, name: sql`excluded.name`, updatedAt: new Date() } })
      .returning({ id: exerciseLogs.id });
    exercise += rows.length;
    dates.add(e.date);
  }
  for (const d of dates) await recomputeDay(db, personId, d);
  return { steps: data.steps.length, sleep: data.sleep.length, heartDays: data.heart.length, weights, exercise };
}
