/**
 * Weekly check-in: every Monday a pending check-in per person (one notification). The person
 * answers (adherence, pace, which partial days to exclude), the proposal is recalculated, and
 * accepting it moves the kcal target. The rows are the history of target changes.
 */
import { and, checkins, dailySummaries, desc, eq, exerciseLogs, gte, heartRateDaily, insights, lt, persons, sleepLogs, targetSets, weightLogs, type Database } from "@nutria/db";
import {
  addDays,
  checkinProposal,
  countsForAverages,
  dayLogStatus,
  isoDow,
  KCAL_PER_KG,
  phaseOfGoal,
  recoverySignal,
  type Adherence,
  type CheckinProposal,
  type CheckinVerdict,
  type DietPhase,
  type Pace,
  type RecoverySignal,
} from "@nutria/nutrition";
import { BULK_REVIEW, setKcalAdjust } from "./bulk";
import { notify } from "./notify";
import { adaptiveSnapshot, recomputeTargets } from "./targets";

export const CHECKIN = "checkin";

export interface CheckinAnswers {
  adherence?: Adherence;
  pace?: Pace;
  /** Partial days the person confirmed should not count. */
  excludeDays?: string[];
}

export interface CheckinData {
  /** Days reviewed (Monday–Sunday before weekStart). */
  from: string;
  to: string;
  phase: DietPhase;
  weightKg: number | null;
  observedRateKgWeek: number | null;
  confidence: number;
  loggedDays: number;
  weekLoggedDays: number;
  weekWeighIns: number;
  avgIntake: number | null;
  /** Days of the week logged by less than half the target and not marked: the check-in asks. */
  suspectDays: { date: string; kcal: number }[];
  proposal: CheckinProposal;
  recovery: RecoverySignal;
}

export type CheckinRow = typeof checkins.$inferSelect & { data: CheckinData; answers: CheckinAnswers };

/** Monday of the week that contains `today` (YYYY-MM-DD). */
export const weekStartOf = (today: string) => addDays(today, 1 - isoDow(today));

/** Builds this week's data and proposal (nothing is written). */
export async function buildCheckin(db: Database, personId: string, answers: CheckinAnswers = {}, now = new Date()) {
  const snap = await adaptiveSnapshot(db, personId, now);
  if (!snap) return null;
  const { pp, today, r } = snap;
  const weekStart = weekStartOf(today);
  const to = addDays(weekStart, -1);
  const from = addDays(weekStart, -7);
  const phase = phaseOfGoal(pp.person.goalType);

  const [days, weights, workouts, hr, sleep, [ts], [prev]] = await Promise.all([
    db.select().from(dailySummaries).where(and(eq(dailySummaries.personId, personId), gte(dailySummaries.date, from), lt(dailySummaries.date, weekStart))),
    db.select({ date: weightLogs.date }).from(weightLogs).where(and(eq(weightLogs.personId, personId), gte(weightLogs.date, from), lt(weightLogs.date, weekStart))),
    db.select({ date: exerciseLogs.date, volumeKg: exerciseLogs.volumeKg }).from(exerciseLogs).where(and(eq(exerciseLogs.personId, personId), gte(exerciseLogs.date, addDays(to, -27)))),
    db.select({ date: heartRateDaily.date, bpm: heartRateDaily.restingBpm }).from(heartRateDaily).where(and(eq(heartRateDaily.personId, personId), gte(heartRateDaily.date, addDays(to, -27)))),
    db.select({ date: sleepLogs.date, hours: sleepLogs.hours }).from(sleepLogs).where(and(eq(sleepLogs.personId, personId), gte(sleepLogs.date, addDays(to, -6)))),
    db.select({ kcal: targetSets.kcal }).from(targetSets).where(and(eq(targetSets.personId, personId), eq(targetSets.isDefault, true))).limit(1),
    db.select().from(checkins).where(and(eq(checkins.personId, personId), lt(checkins.weekStart, weekStart))).orderBy(desc(checkins.weekStart)).limit(1),
  ]);
  const excluded = new Set(answers.excludeDays ?? []);
  const statusOf = (d: (typeof days)[number]) => dayLogStatus({ kcal: d.kcal, entries: d.entries, complete: d.complete, incomplete: d.incomplete || excluded.has(d.date) }, ts?.kcal);
  const weekLoggedDays = days.filter((d) => countsForAverages(statusOf(d))).length;
  const suspectDays = days
    .filter((d) => dayLogStatus({ kcal: d.kcal, entries: d.entries, complete: d.complete, incomplete: d.incomplete }, ts?.kcal) === "suspect")
    .map((d) => ({ date: d.date, kcal: Math.round(d.kcal) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // A change that was accepted starts the count again: the new kcal need a couple of weeks to show.
  const prevData = prev?.data as Partial<CheckinData> | undefined;
  const previousVerdict: CheckinVerdict | null = prev && prev.status === "accepted" && prev.kcalDelta ? null : (prevData?.proposal?.verdict ?? null);
  const weightKg = r.trendEnd ?? pp.profile.weightKg ?? null;
  const proposal = checkinProposal({
    phase,
    weightKg,
    rateKgWeek: pp.person.weeklyRateKg,
    observedRateKgWeek: r.observedRateKgWeek,
    confidence: r.confidence,
    loggedDays: r.loggedDays,
    weekLoggedDays,
    weekWeighIns: weights.length,
    adherence: answers.adherence ?? "all",
    pace: answers.pace ?? "keep",
    previousVerdict,
  });
  const recovery = recoverySignal({
    today: to,
    workouts: workouts,
    restingHr: hr.flatMap((h) => (h.bpm != null ? [{ date: h.date, bpm: h.bpm }] : [])),
    sleep,
  });
  const data: CheckinData = {
    from,
    to,
    phase,
    weightKg: weightKg == null ? null : Math.round(weightKg * 10) / 10,
    observedRateKgWeek: r.observedRateKgWeek == null ? null : Math.round(r.observedRateKgWeek * 100) / 100,
    confidence: r.confidence,
    loggedDays: r.loggedDays,
    weekLoggedDays,
    weekWeighIns: weights.length,
    avgIntake: r.avgIntake,
    suspectDays,
    proposal,
    recovery,
  };
  return { weekStart, today, phase, kcalBefore: ts?.kcal ?? null, data, userId: pp.person.userId, timezone: pp.person.timezone };
}

const asRow = (r: typeof checkins.$inferSelect) => r as CheckinRow;

export async function getCheckin(db: Database, personId: string, id: string) {
  const [r] = await db.select().from(checkins).where(and(eq(checkins.id, id), eq(checkins.personId, personId))).limit(1);
  return r ? asRow(r) : null;
}

export async function listCheckins(db: Database, personId: string, limit = 12) {
  return (await db.select().from(checkins).where(eq(checkins.personId, personId)).orderBy(desc(checkins.weekStart)).limit(limit)).map(asRow);
}

/** This week's check-in, if it exists. */
export async function currentCheckin(db: Database, personId: string, today: string) {
  const [r] = await db.select().from(checkins).where(and(eq(checkins.personId, personId), eq(checkins.weekStart, weekStartOf(today)))).limit(1);
  return r ? asRow(r) : null;
}

/**
 * Creates (or refreshes, while still pending) this week's check-in. One notification, the first
 * time. Decided check-ins are left alone.
 */
export async function weeklyCheckin(db: Database, personId: string, now = new Date(), opts: { notify?: boolean } = {}) {
  const b = await buildCheckin(db, personId, {}, now);
  if (!b) return null;
  const [existing] = await db.select().from(checkins).where(and(eq(checkins.personId, personId), eq(checkins.weekStart, b.weekStart))).limit(1);
  if (existing && existing.status !== "pending") return asRow(existing);
  const answers = (existing?.answers ?? {}) as CheckinAnswers;
  const built = Object.keys(answers).length ? ((await buildCheckin(db, personId, answers, now)) ?? b) : b;
  const values = { phase: built.phase, kcalBefore: built.kcalBefore, kcalDelta: built.data.proposal.kcalDelta + built.data.proposal.paceKcal, data: built.data as unknown as Record<string, unknown>, updatedAt: new Date() };
  const [row] = existing
    ? await db.update(checkins).set(values).where(eq(checkins.id, existing.id)).returning()
    : await db.insert(checkins).values({ personId, weekStart: built.weekStart, ...values }).returning();
  if (!existing && opts.notify !== false && built.userId) {
    const p = built.data.proposal;
    await notify(db, {
      userId: built.userId,
      type: CHECKIN,
      title: "📋 Check-in semanal",
      body: p.kcalDelta ? `${p.reasons[0]} Revísalo y decide.` : "Dos preguntas y ves cómo vas esta semana.",
      url: "/progreso/checkin",
      tag: `checkin-${built.weekStart}`,
      timezone: built.timezone,
    });
  }
  return asRow(row!);
}

/** Save the answers and recalculate the proposal; excluded days are marked as partly logged. */
export async function answerCheckin(db: Database, personId: string, id: string, answers: CheckinAnswers, now = new Date()) {
  const c = await getCheckin(db, personId, id);
  if (!c || c.status !== "pending") throw new Error("Este check-in ya está decidido");
  const suspect = new Set(c.data.suspectDays.map((d) => d.date));
  const exclude = (answers.excludeDays ?? []).filter((d) => suspect.has(d));
  for (const d of suspect)
    await db
      .update(dailySummaries)
      .set({ incomplete: exclude.includes(d), complete: false })
      .where(and(eq(dailySummaries.personId, personId), eq(dailySummaries.date, d)));
  const clean: CheckinAnswers = { adherence: answers.adherence ?? "all", pace: answers.pace ?? "keep", excludeDays: exclude };
  const b = await buildCheckin(db, personId, clean, now);
  if (!b) throw new Error("Faltan datos del perfil para el check-in");
  // The suspect list is the one shown to the person (days just excluded are no longer "suspect").
  const data: CheckinData = { ...b.data, suspectDays: c.data.suspectDays };
  const [row] = await db
    .update(checkins)
    .set({ answers: clean as Record<string, unknown>, data: data as unknown as Record<string, unknown>, kcalDelta: data.proposal.kcalDelta + data.proposal.paceKcal, updatedAt: new Date() })
    .where(eq(checkins.id, id))
    .returning();
  return asRow(row!);
}

/** Accept (apply the kcal change and the new pace) or reject this week's proposal. */
export async function decideCheckin(db: Database, personId: string, id: string, accept: boolean) {
  const c = await getCheckin(db, personId, id);
  if (!c) throw new Error("Ese check-in no existe");
  if (c.status !== "pending") return c;
  let kcalAfter = c.kcalBefore;
  if (accept) {
    const p = c.data.proposal;
    const [cur] = await db.select().from(targetSets).where(and(eq(targetSets.personId, personId), eq(targetSets.isDefault, true))).limit(1);
    if (!cur) throw new Error("Primero hay que calcular tus objetivos");
    let adjust = cur.kcalAdjust;
    if (p.rateChangeKgWeek) {
      await db.update(persons).set({ weeklyRateKg: p.targetRateKgWeek }).where(eq(persons.id, personId));
      // Calculated targets take the new rate from the profile; manual ones move by its kcal.
      if (cur.mode === "fixed") adjust += Math.round((p.rateChangeKgWeek * KCAL_PER_KG) / 7 / 25) * 25;
      else await recomputeTargets(db, personId);
    }
    adjust += p.kcalDelta;
    const t = adjust !== cur.kcalAdjust ? await setKcalAdjust(db, personId, adjust) : null;
    kcalAfter = t?.kcal ?? (await db.select({ kcal: targetSets.kcal }).from(targetSets).where(and(eq(targetSets.personId, personId), eq(targetSets.isDefault, true))).limit(1))[0]?.kcal ?? null;
    // The bulk review of the same weeks is the same decision: it no longer offers its own button.
    const [bulk] = await db.select().from(insights).where(and(eq(insights.personId, personId), eq(insights.kind, BULK_REVIEW), gte(insights.periodEnd, c.data.from))).orderBy(desc(insights.periodEnd)).limit(1);
    if (bulk && !(bulk.data as { appliedAt?: string }).appliedAt) await db.update(insights).set({ data: { ...(bulk.data as Record<string, unknown>), appliedAt: new Date().toISOString() } }).where(eq(insights.id, bulk.id));
  }
  const [row] = await db
    .update(checkins)
    .set({ status: accept ? "accepted" : "rejected", kcalAfter: kcalAfter == null ? null : Math.round(kcalAfter), decidedAt: new Date(), updatedAt: new Date() })
    .where(eq(checkins.id, id))
    .returning();
  return asRow(row!);
}
