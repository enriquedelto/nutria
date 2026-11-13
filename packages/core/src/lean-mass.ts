/** Lean-mass watch: training adherence, weight with waist, and strength — no food diary needed. */
import { and, asc, bodyMeasurements, eq, exerciseLogs, gte, persons, weightLogs, type Database } from "@nutria/db";
import { addDays, continuous, daysBetween, leanMassCheck, liftSeries, strengthTrend, todayIn, trendWeights, type LeanMassCheck, type LiftSeries } from "@nutria/nutrition";
import { notify } from "./notify";
import { getSportProfile } from "./sport";

export const LEAN_MASS = "lean_mass";

export interface LeanMassStatus {
  check: LeanMassCheck;
  plannedPerWeek: number | null;
  sessionsLast28: number;
  daysSinceLast: number | null;
  weightChangeKg: number | null;
  waistChangeCm: number | null;
  strengthPct: number | null;
  /** e1RM over the last ~6 months of the most trained lifts (for the Progreso chart). */
  lifts: LiftSeries[];
}

export async function leanMassStatus(db: Database, personId: string, now = new Date()): Promise<LeanMassStatus | null> {
  const [p] = await db.select({ tz: persons.timezone, goalType: persons.goalType }).from(persons).where(eq(persons.id, personId)).limit(1);
  if (!p) return null;
  const today = todayIn(p.tz, now);
  const [sport, logs, weights, waist] = await Promise.all([
    getSportProfile(db, personId),
    db.select({ date: exerciseLogs.date, volumeKg: exerciseLogs.volumeKg, details: exerciseLogs.details }).from(exerciseLogs).where(and(eq(exerciseLogs.personId, personId), gte(exerciseLogs.date, addDays(today, -182)))).orderBy(asc(exerciseLogs.date)),
    db.select({ date: weightLogs.date, kg: weightLogs.kg }).from(weightLogs).where(and(eq(weightLogs.personId, personId), gte(weightLogs.date, addDays(today, -45)))).orderBy(asc(weightLogs.date)),
    db.select({ date: bodyMeasurements.date, cm: bodyMeasurements.cm }).from(bodyMeasurements).where(and(eq(bodyMeasurements.personId, personId), eq(bodyMeasurements.site, "waist"), gte(bodyMeasurements.date, addDays(today, -42)))).orderBy(asc(bodyMeasurements.date)),
  ]);
  const days = [...new Set(logs.map((l) => l.date))];
  const last = days.at(-1) ?? null;
  const sessionsLast28 = days.filter((d) => d > addDays(today, -28)).length;
  const daysSinceLast = last ? daysBetween(last, today) : null;
  const plannedPerWeek = sport.active && sport.profile.trainingDays?.length ? sport.profile.trainingDays.length : null;

  // Trend weight now vs. 4 weeks ago (smoothed, so one heavy morning does not count).
  let weightChangeKg: number | null = null;
  if (weights.length >= 2 && daysBetween(weights[0]!.date, weights.at(-1)!.date) >= 21) {
    const series = continuous(weights.map((w) => ({ date: w.date, weightKg: w.kg })), weights[0]!.date, today);
    const trend = trendWeights(series);
    const at = (d: string) => trend[series.findIndex((s) => s.date === d)] ?? null;
    const before = at(addDays(today, -28)) ?? trend.find((t) => t != null) ?? null;
    const nowT = trend.at(-1) ?? null;
    if (before != null && nowT != null) weightChangeKg = Math.round((nowT - before) * 10) / 10;
  }
  const waistChangeCm = waist.length >= 2 && daysBetween(waist[0]!.date, waist.at(-1)!.date) >= 21 ? Math.round((waist.at(-1)!.cm - waist[0]!.cm) * 10) / 10 : null;
  const strength = strengthTrend(logs, today);
  const check = leanMassCheck({ plannedPerWeek, sessionsLast28, daysSinceLast, weightChangeKg, strengthPct: strength.pct, waistChangeCm, cutting: p.goalType === "lose" });
  return { check, plannedPerWeek, sessionsLast28, daysSinceLast, weightChangeKg, waistChangeCm, strengthPct: strength.pct, lifts: liftSeries(logs, addDays(today, -182)) };
}

/** Weekly: a push when the signals point to losing lean mass. */
export async function notifyLeanMass(db: Database, personId: string, now = new Date()) {
  const [p] = await db.select({ userId: persons.userId, tz: persons.timezone }).from(persons).where(eq(persons.id, personId)).limit(1);
  if (!p?.userId) return false;
  const s = await leanMassStatus(db, personId, now);
  if (s?.check.level !== "alert") return false;
  await notify(db, { userId: p.userId, type: LEAN_MASS, title: "⚠️ Posible pérdida de masa magra", body: s.check.reasons.slice(0, 2).join(" "), url: "/progreso#masa-magra", timezone: p.tz });
  return true;
}
