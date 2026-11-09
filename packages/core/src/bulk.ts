/** Weekly bulk review (goal "gain"): rate vs. target, kcal proposal, sets per muscle, strength and waist. */
import { and, bodyMeasurements, desc, eq, exerciseLogs, gte, insights, lt, persons, targetSets, type Database } from "@nutria/db";
import { addDays, bodySignal, bulkReview, MAIN_MUSCLES, setsByMuscle, strengthChangePct, trainingProgress, type BodySignalKind, type BulkVerdict, type MuscleGroup } from "@nutria/nutrition";
import MUSCLES from "./opengym-muscles.json";
import { notify } from "./notify";
import { adaptiveSnapshot, recomputeTargets } from "./targets";

export const BULK_REVIEW = "bulk_review";

const MUSCLE_OF = MUSCLES as Record<string, string>;
const NONE: MuscleGroup[] = [];
/** Muscles of an openGym catalogue exercise, main one first (custom exercises have none). */
export const exerciseMuscles = (id: string): MuscleGroup[] => (MUSCLE_OF[id]?.split(",") as MuscleGroup[] | undefined) ?? NONE;

export interface BulkReviewData {
  verdict: BulkVerdict;
  ratio: number | null;
  kcalDelta: number;
  message: string;
  targetRateKgWeek: number;
  observedRateKgWeek: number | null;
  confidence: number;
  loggedDays: number;
  currentKcal: number | null;
  kcalAdjust: number;
  /** Working sets per main muscle: last 7 days and weekly average of the last 4 weeks. */
  sets: { muscle: MuscleGroup; week: number; avg4: number }[];
  /** Workouts in the last 4 weeks that had exercises with a known muscle. */
  trainedSessions: number;
  strengthChangePct: number | null;
  lifts: { name: string; e1rm: number; change: number | null; trend: number[] }[];
  weightChangeKg: number | null;
  waistChangeCm: number | null;
  signal: { kind: BodySignalKind; text: string };
  appliedAt?: string;
}

const TITLES: Record<BulkVerdict, string> = {
  slow: "Volumen: subes despacio",
  on_track: "Volumen: vas bien",
  fast: "Volumen: subes deprisa",
  no_data: "Volumen: faltan datos",
};

/** Latest review of a person (the card in Progreso and the coach tool). */
export async function latestBulkReview(db: Database, personId: string) {
  const [r] = await db.select().from(insights).where(and(eq(insights.personId, personId), eq(insights.kind, BULK_REVIEW))).orderBy(desc(insights.periodEnd), desc(insights.createdAt)).limit(1);
  return r ? { ...r, data: r.data as unknown as BulkReviewData } : null;
}

/**
 * Builds (or rebuilds) this week's review. Runs on Mondays after the adaptive TDEE; only for
 * people whose goal is to gain. Notifies when there is a kcal proposal.
 */
export async function weeklyBulkReview(db: Database, personId: string, now = new Date()) {
  const [p] = await db.select({ goalType: persons.goalType, userId: persons.userId, timezone: persons.timezone }).from(persons).where(eq(persons.id, personId)).limit(1);
  if (p?.goalType !== "gain") return null;
  const snap = await adaptiveSnapshot(db, personId, now);
  if (!snap) return null;
  const { pp, today, end, r } = snap;

  const [prev] = await db
    .select({ data: insights.data })
    .from(insights)
    .where(and(eq(insights.personId, personId), eq(insights.kind, BULK_REVIEW), lt(insights.periodEnd, end), gte(insights.periodEnd, addDays(end, -13))))
    .orderBy(desc(insights.periodEnd))
    .limit(1);
  const prevData = prev?.data as Partial<BulkReviewData> | undefined;
  // An applied proposal starts the count again: the new kcal need a couple of weeks to show.
  const previousVerdict = prevData?.appliedAt ? null : (prevData?.verdict ?? null);
  const targetRate = pp.profile.weeklyRateKg && pp.profile.weeklyRateKg > 0 ? pp.profile.weeklyRateKg : 0.25;
  const review = bulkReview({ targetRateKgWeek: targetRate, observedRateKgWeek: r.observedRateKgWeek, confidence: r.confidence, loggedDays: r.loggedDays, previousVerdict });

  const [logs, waist, [ts]] = await Promise.all([
    db.select({ date: exerciseLogs.date, volumeKg: exerciseLogs.volumeKg, details: exerciseLogs.details }).from(exerciseLogs).where(and(eq(exerciseLogs.personId, personId), gte(exerciseLogs.date, addDays(today, -42)))),
    db.select({ date: bodyMeasurements.date, cm: bodyMeasurements.cm }).from(bodyMeasurements).where(and(eq(bodyMeasurements.personId, personId), eq(bodyMeasurements.site, "waist"), gte(bodyMeasurements.date, addDays(today, -35)))).orderBy(bodyMeasurements.date),
    db.select({ kcal: targetSets.kcal, kcalAdjust: targetSets.kcalAdjust }).from(targetSets).where(and(eq(targetSets.personId, personId), eq(targetSets.isDefault, true))).limit(1),
  ]);
  const week = setsByMuscle(logs, exerciseMuscles, addDays(end, -6), end);
  const four = setsByMuscle(logs, exerciseMuscles, addDays(end, -27), end);
  const trainedSessions = logs.filter((l) => l.date >= addDays(end, -27) && Array.isArray(l.details.exercises) && (l.details.exercises as { id?: string }[]).some((e) => e?.id && exerciseMuscles(e.id).length)).length;
  const strength = strengthChangePct(logs, today);
  const lifts = trainingProgress(logs, today, 6, 3).lifts.map((l) => ({ name: l.name, e1rm: l.best.e1rm, change: l.change, trend: l.trend }));
  const waistChangeCm = waist.length >= 2 && waist.at(-1)!.date >= addDays(waist[0]!.date, 21) ? Math.round((waist.at(-1)!.cm - waist[0]!.cm) * 10) / 10 : null;
  const weightChangeKg = r.observedRateKgWeek == null ? null : Math.round(r.observedRateKgWeek * 4 * 10) / 10;

  const data: BulkReviewData = {
    ...review,
    targetRateKgWeek: targetRate,
    observedRateKgWeek: r.observedRateKgWeek == null ? null : Math.round(r.observedRateKgWeek * 100) / 100,
    confidence: r.confidence,
    loggedDays: r.loggedDays,
    currentKcal: ts?.kcal ?? null,
    kcalAdjust: ts?.kcalAdjust ?? 0,
    sets: MAIN_MUSCLES.map((m) => ({ muscle: m, week: Math.round(week[m] * 2) / 2, avg4: Math.round((four[m] / 4) * 2) / 2 })),
    trainedSessions,
    strengthChangePct: strength,
    lifts,
    weightChangeKg,
    waistChangeCm,
    signal: bodySignal({ weightChangeKg, strengthChangePct: strength, waistChangeCm }),
  };
  const row = {
    personId,
    kind: BULK_REVIEW,
    title: TITLES[review.verdict],
    bodyMd: `${review.message}\n\n${data.signal.text}`,
    data: data as unknown as Record<string, unknown>,
    score: review.ratio,
    periodStart: addDays(end, -27),
    periodEnd: end,
  };
  await db.transaction(async (tx) => {
    await tx.delete(insights).where(and(eq(insights.personId, personId), eq(insights.kind, BULK_REVIEW), eq(insights.periodEnd, end)));
    await tx.insert(insights).values(row);
  });
  if (review.kcalDelta && p.userId)
    await notify(db, { userId: p.userId, type: BULK_REVIEW, title: `💪 ${TITLES[review.verdict]}`, body: review.message, url: "/progreso#volumen", timezone: p.timezone });
  return data;
}

/** Apply a review's kcal proposal: kept as an adjustment over the estimated expenditure. */
export async function applyBulkReview(db: Database, personId: string, insightId: string) {
  const [i] = await db.select().from(insights).where(and(eq(insights.id, insightId), eq(insights.personId, personId), eq(insights.kind, BULK_REVIEW))).limit(1);
  const d = i?.data as unknown as BulkReviewData | undefined;
  if (!i || !d?.kcalDelta) throw new Error("Esta revisión no tiene ninguna propuesta");
  if (d.appliedAt) return null;
  const t = await setKcalAdjust(db, personId, (await currentAdjust(db, personId)) + d.kcalDelta);
  await db
    .update(insights)
    .set({ data: { ...d, appliedAt: new Date().toISOString() } as unknown as Record<string, unknown> })
    .where(eq(insights.id, i.id));
  return t;
}

async function currentAdjust(db: Database, personId: string) {
  const [t] = await db.select({ a: targetSets.kcalAdjust }).from(targetSets).where(and(eq(targetSets.personId, personId), eq(targetSets.isDefault, true))).limit(1);
  return t?.a ?? 0;
}

/**
 * Set the kcal adjustment of the default target set. Calculated targets are recomputed; manual
 * ("fixed") ones move kcal and carbs by the difference, so they stay manual.
 */
export async function setKcalAdjust(db: Database, personId: string, kcalAdjust: number) {
  const [cur] = await db.select().from(targetSets).where(and(eq(targetSets.personId, personId), eq(targetSets.isDefault, true))).limit(1);
  if (!cur) throw new Error("Primero hay que calcular tus objetivos");
  const next = Math.round(kcalAdjust);
  if (cur.mode !== "fixed") return recomputeTargets(db, personId, { kcalAdjust: next });
  const diff = next - cur.kcalAdjust;
  const [u] = await db
    .update(targetSets)
    .set({ kcal: Math.round(cur.kcal + diff), carbs: Math.max(0, Math.round(cur.carbs + diff / 4)), kcalAdjust: next })
    .where(eq(targetSets.id, cur.id))
    .returning();
  return u!;
}
