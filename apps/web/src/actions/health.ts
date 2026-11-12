"use server";
import { UserError } from "@/lib/errors";
import { refresh } from "next/cache";
import { z } from "zod";
import {
  activities,
  and,
  bodyMeasurements,
  cyclePeriods,
  cycleSymptoms,
  eq,
  exerciseLogs,
  fastingSessions,
  goals,
  isNull,
  labReports,
  labResults,
  mealFeelings,
  medicationDoses,
  medications,
  personConditions,
  sleepLogs,
  sql,
  stepLogs,
  supplementSchedules,
  symptomLogs,
  targetSets,
  weightLogs,
  type AccessScope,
} from "@nutria/db";
import { acceptTdeeEstimate, addSupplementPlan, applyBulkReview, setKcalAdjust, weeklyBulkReview, latestWeight, missingProfileFields, recomputeDay, recomputeTargets, takeSupplement, untakeSupplement } from "@nutria/core";
import { detectSubstance, exerciseKcal, stepsKcal, SUPPLEMENT_BY_CODE } from "@nutria/nutrition";
import { db } from "@/lib/db";
import { recomputeTargetsSafe } from "@/lib/targets";
import { emit } from "@/lib/events";
import { enqueue } from "@/lib/jobs";
import { assertAccess, getApiUser } from "@/lib/session";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

async function guard(personId: string, scope: AccessScope) {
  const u = await getApiUser();
  if (!u) throw new UserError("No autenticado");
  await assertAccess(u.id, uuid.parse(personId), scope, true);
  return u;
}

/* ------------------------------ body ------------------------------ */

export async function logWeight(personId: string, input: { date: string; kg: number; bodyFatPct?: number | null; note?: string | null }) {
  const u = await guard(personId, "body");
  const v = z.object({ date: day, kg: z.number().min(2).max(400), bodyFatPct: z.number().min(2).max(70).nullish(), note: z.string().max(300).nullish() }).parse(input);
  await db()
    .insert(weightLogs)
    .values({ personId, date: v.date, kg: v.kg, bodyFatPct: v.bodyFatPct ?? null, note: v.note ?? null, source: "manual", measuredAt: new Date() });
  await recomputeTargetsSafe(personId);
  void emit(u.id, "weight.logged", { personId, date: v.date, kg: v.kg });
  refresh();
}

export async function deleteWeight(personId: string, id: string) {
  await guard(personId, "body");
  await db().delete(weightLogs).where(and(eq(weightLogs.id, uuid.parse(id)), eq(weightLogs.personId, personId)));
  refresh();
}

export async function logMeasurements(personId: string, date: string, sites: Record<string, number>) {
  await guard(personId, "body");
  const rows = Object.entries(sites)
    .filter(([, cm]) => Number.isFinite(cm) && cm > 0 && cm < 300)
    .map(([site, cm]) => ({ personId, date: day.parse(date), site: z.string().max(30).parse(site), cm }));
  if (rows.length)
    await db()
      .insert(bodyMeasurements)
      .values(rows)
      .onConflictDoUpdate({ target: [bodyMeasurements.personId, bodyMeasurements.date, bodyMeasurements.site], set: { cm: sql`excluded.cm` } });
  refresh();
}

export async function setGoal(personId: string, input: { type: string; targetValue: number; targetDate?: string | null }) {
  await guard(personId, "body");
  const w = await latestWeight(db(), personId);
  await db().update(goals).set({ status: "abandoned" }).where(and(eq(goals.personId, personId), eq(goals.status, "active"), eq(goals.type, input.type)));
  await db()
    .insert(goals)
    .values({ personId, type: z.enum(["weight", "body_fat", "waist"]).parse(input.type), targetValue: input.targetValue, startValue: input.type === "weight" ? (w?.kg ?? null) : null, startDate: new Date().toISOString().slice(0, 10), targetDate: input.targetDate ?? null, status: "active" });
  refresh();
}

/** Accept the adaptive TDEE suggestion: new targets keep pinned macros. */
export async function acceptTdee(personId: string, estimateId: string) {
  await guard(personId, "body");
  if (!(await acceptTdeeEstimate(db(), personId, uuid.parse(estimateId)))) throw new UserError("Estimación no disponible");
  refresh();
}

/** Apply the kcal proposal of a bulk review (kept as an adjustment over the expenditure). */
export async function applyBulkReviewAction(personId: string, insightId: string) {
  await guard(personId, "body");
  try {
    await applyBulkReview(db(), personId, uuid.parse(insightId));
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : "No se pudo aplicar");
  }
  refresh();
}

/** Remove the accepted kcal adjustment (back to the estimated expenditure). */
export async function clearKcalAdjust(personId: string) {
  await guard(personId, "body");
  await setKcalAdjust(db(), personId, 0).catch((e) => {
    throw new UserError(e instanceof Error ? e.message : "No se pudo quitar el ajuste");
  });
  refresh();
}

/** Build this week's bulk review now (it also runs by itself on Mondays). */
export async function reviewBulkNow(personId: string) {
  await guard(personId, "body");
  const r = await weeklyBulkReview(db(), personId);
  if (!r) throw new UserError("La revisión del volumen es para el objetivo «ganar peso» y necesita tu perfil completo");
  refresh();
  return { verdict: r.verdict };
}

/* ---------------------------- activity ---------------------------- */

export async function logExercise(personId: string, input: { date: string; activityCode: string; minutes: number; name?: string; kcal?: number | null }) {
  await guard(personId, "body");
  const v = z.object({ date: day, activityCode: z.string().max(60), minutes: z.number().min(1).max(1440), name: z.string().max(80).optional(), kcal: z.number().min(0).max(10000).nullish() }).parse(input);
  const [act] = await db().select().from(activities).where(eq(activities.code, v.activityCode)).limit(1);
  const w = (await latestWeight(db(), personId))?.kg ?? 70;
  const kcal = v.kcal ?? (act ? exerciseKcal(act.met, w, v.minutes) : 0);
  await db().insert(exerciseLogs).values({ personId, date: v.date, activityCode: act?.code ?? null, name: v.name || act?.nameEs || "Ejercicio", durationMin: v.minutes, kcal, met: act?.met ?? null, source: "manual" });
  await recomputeDay(db(), personId, v.date);
  refresh();
}

export async function deleteExercise(personId: string, id: string) {
  await guard(personId, "body");
  const [r] = await db().delete(exerciseLogs).where(and(eq(exerciseLogs.id, uuid.parse(id)), eq(exerciseLogs.personId, personId))).returning({ date: exerciseLogs.date });
  if (r) await recomputeDay(db(), personId, r.date);
  refresh();
}

export async function logSteps(personId: string, date: string, steps: number) {
  await guard(personId, "body");
  const w = (await latestWeight(db(), personId))?.kg ?? 70;
  const s = z.number().int().min(0).max(150_000).parse(steps);
  await db()
    .insert(stepLogs)
    .values({ personId, date: day.parse(date), steps: s, kcal: stepsKcal(s, w) })
    .onConflictDoUpdate({ target: [stepLogs.personId, stepLogs.date], set: { steps: s, kcal: stepsKcal(s, w) } });
  refresh();
}

export async function startFast(personId: string, protocol: string, targetHours: number) {
  await guard(personId, "diary");
  await db().update(fastingSessions).set({ endedAt: new Date() }).where(and(eq(fastingSessions.personId, personId), isNull(fastingSessions.endedAt)));
  await db().insert(fastingSessions).values({ personId, protocol: z.string().max(20).parse(protocol), targetHours: z.number().min(1).max(168).parse(targetHours), startedAt: new Date() });
  refresh();
}

export async function endFast(personId: string, note?: string) {
  await guard(personId, "diary");
  await db().update(fastingSessions).set({ endedAt: new Date(), note: note ?? null }).where(and(eq(fastingSessions.personId, personId), isNull(fastingSessions.endedAt)));
  refresh();
}

/* ------------------------- sleep and cycle ------------------------- */

export async function logSleep(personId: string, input: { date: string; bedtime: string; wakeTime: string; quality?: number | null; note?: string | null }) {
  await guard(personId, "health");
  const bed = new Date(input.bedtime), wake = new Date(input.wakeTime);
  if (!(wake > bed)) throw new UserError("La hora de despertar debe ser posterior");
  const hours = Math.round(((wake.getTime() - bed.getTime()) / 3_600_000) * 10) / 10;
  await db()
    .insert(sleepLogs)
    .values({ personId, date: day.parse(input.date), bedtime: bed, wakeTime: wake, hours, quality: input.quality ?? null, note: input.note ?? null })
    .onConflictDoUpdate({ target: [sleepLogs.personId, sleepLogs.date], set: { bedtime: bed, wakeTime: wake, hours, quality: input.quality ?? null, note: input.note ?? null } });
  refresh();
}

export async function logPeriod(personId: string, input: { startDate: string; endDate?: string | null; flow?: number | null }) {
  await guard(personId, "cycle");
  await db().insert(cyclePeriods).values({ personId, startDate: day.parse(input.startDate), endDate: input.endDate ? day.parse(input.endDate) : null, flow: input.flow == null ? null : z.number().int().min(1).max(4).parse(input.flow) });
  refresh();
}

export async function endPeriod(personId: string, id: string, endDate: string) {
  await guard(personId, "cycle");
  await db().update(cyclePeriods).set({ endDate: day.parse(endDate) }).where(and(eq(cyclePeriods.id, uuid.parse(id)), eq(cyclePeriods.personId, personId)));
  refresh();
}

export async function logCycleSymptom(personId: string, date: string, symptom: string, intensity: number) {
  await guard(personId, "cycle");
  await db().insert(cycleSymptoms).values({ personId, date: day.parse(date), symptom: z.string().max(40).parse(symptom), intensity: z.number().int().min(1).max(5).parse(intensity) });
  refresh();
}

/* ------------------------ symptoms and feelings ------------------------ */

export async function logSymptom(personId: string, input: { occurredAt: string; symptom: string; intensity: number; note?: string | null }) {
  await guard(personId, "health");
  const at = new Date(input.occurredAt);
  await db()
    .insert(symptomLogs)
    .values({ personId, occurredAt: at, date: at.toISOString().slice(0, 10), symptom: z.string().min(1).max(60).parse(input.symptom), intensity: z.number().int().min(1).max(5).parse(input.intensity), note: input.note ?? null });
  refresh();
}

export async function deleteSymptom(personId: string, id: string) {
  await guard(personId, "health");
  await db().delete(symptomLogs).where(and(eq(symptomLogs.id, uuid.parse(id)), eq(symptomLogs.personId, personId)));
  refresh();
}

export async function logFeeling(personId: string, input: { date: string; mealSlot: string; hungerBefore?: number | null; satietyAfter?: number | null; mood?: number | null; note?: string | null }) {
  await guard(personId, "diary");
  await db()
    .insert(mealFeelings)
    .values({ personId, date: day.parse(input.date), mealSlot: input.mealSlot, hungerBefore: input.hungerBefore ?? null, satietyAfter: input.satietyAfter ?? null, mood: input.mood ?? null, note: input.note ?? null })
    .onConflictDoUpdate({
      target: [mealFeelings.personId, mealFeelings.date, mealFeelings.mealSlot],
      set: { hungerBefore: input.hungerBefore ?? null, satietyAfter: input.satietyAfter ?? null, mood: input.mood ?? null, note: input.note ?? null },
    });
  refresh();
}

export async function runCorrelationsNow(personId: string) {
  await guard(personId, "health");
  await enqueue("insights.correlations", { personId });
}

/* ---------------------------- medication ---------------------------- */

const MedInput = z.object({
  name: z.string().min(1).max(80),
  activeIngredient: z.string().max(80).nullish(),
  dose: z.string().max(40).nullish(),
  times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(8),
  // Empty means every day (that is what the form says); stored explicitly so the dose generator sees it.
  daysOfWeek: z.array(z.number().int().min(1).max(7)).max(7).default([]).transform((d) => (d.length ? [...new Set(d)].sort() : [1, 2, 3, 4, 5, 6, 7])),
  withFood: z.enum(["with", "without", "any"]).default("any"),
  startDate: day.nullish(),
  endDate: day.nullish(),
  note: z.string().max(300).nullish(),
});

export async function saveMedication(personId: string, input: z.input<typeof MedInput>, id?: string) {
  await guard(personId, "medication");
  const v = MedInput.parse(input);
  const values = { ...v, substanceCode: detectSubstance(`${v.name} ${v.activeIngredient ?? ""}`), activeIngredient: v.activeIngredient ?? null, dose: v.dose ?? null, startDate: v.startDate ?? null, endDate: v.endDate ?? null, note: v.note ?? null };
  if (id) await db().update(medications).set(values).where(and(eq(medications.id, uuid.parse(id)), eq(medications.personId, personId)));
  else await db().insert(medications).values({ personId, ...values, active: true });
  await enqueue("medication.doses", {});
  refresh();
}

export async function setMedicationActive(personId: string, id: string, active: boolean) {
  await guard(personId, "medication");
  await db().update(medications).set({ active }).where(and(eq(medications.id, uuid.parse(id)), eq(medications.personId, personId)));
  refresh();
}

export async function deleteMedication(personId: string, id: string) {
  await guard(personId, "medication");
  await db().delete(medications).where(and(eq(medications.id, uuid.parse(id)), eq(medications.personId, personId)));
  refresh();
}

export async function markDose(personId: string, doseId: string, status: "taken" | "skipped" | "pending") {
  await guard(personId, "medication");
  await db()
    .update(medicationDoses)
    .set({ status, takenAt: status === "taken" ? new Date() : null })
    .where(and(eq(medicationDoses.id, uuid.parse(doseId)), eq(medicationDoses.personId, personId)));
  refresh();
}

/* ---------------------------- conditions ---------------------------- */

/** Toggle a condition; its config (e.g. the sport profile) is kept unless a new one is given. */
export async function setCondition(personId: string, code: string, active: boolean, config?: Record<string, unknown>) {
  await guard(personId, "health");
  await db()
    .insert(personConditions)
    .values({ personId, conditionCode: code, active, config: config ?? {}, since: new Date().toISOString().slice(0, 10) })
    .onConflictDoUpdate({ target: [personConditions.personId, personConditions.conditionCode], set: { active, ...(config ? { config } : {}) } });
  await recomputeTargetsSafe(personId);
  refresh();
}

/* ---------------------------- supplements ---------------------------- */

const hhmmZ = z.string().regex(/^\d{2}:\d{2}$/);
const SupplementPlan = z.object({
  code: z.string().max(30).optional(),
  foodId: uuid.optional(),
  dose: z.number().positive().max(10_000),
  doseUnit: z.string().trim().min(1).max(20),
  gramsPerDose: z.number().positive().max(500),
  times: z.array(hhmmZ).max(6),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1).max(7),
});

export async function saveSupplementPlan(personId: string, input: z.input<typeof SupplementPlan>, id?: string) {
  const u = await guard(personId, "diary");
  const v = SupplementPlan.parse(input);
  if (!id && !v.foodId && !(v.code && SUPPLEMENT_BY_CODE[v.code])) throw new UserError("Elige un suplemento");
  const days = [...new Set(v.daysOfWeek)].sort();
  if (id) {
    await db()
      .update(supplementSchedules)
      .set({ dose: v.dose, doseUnit: v.doseUnit, gramsPerDose: v.gramsPerDose, times: v.times, daysOfWeek: days, updatedAt: new Date() })
      .where(and(eq(supplementSchedules.id, uuid.parse(id)), eq(supplementSchedules.personId, personId)));
  } else await addSupplementPlan(db(), personId, u.id, { ...v, daysOfWeek: days });
  refresh();
}

export async function setSupplementActive(personId: string, id: string, active: boolean) {
  await guard(personId, "diary");
  await db().update(supplementSchedules).set({ active }).where(and(eq(supplementSchedules.id, uuid.parse(id)), eq(supplementSchedules.personId, personId)));
  refresh();
}

export async function deleteSupplementPlan(personId: string, id: string) {
  await guard(personId, "diary");
  await db().delete(supplementSchedules).where(and(eq(supplementSchedules.id, uuid.parse(id)), eq(supplementSchedules.personId, personId)));
  refresh();
}

/** Mark today's dose of a plan as taken (diary entry) or undo it. */
export async function markSupplement(personId: string, scheduleId: string, date: string, taken: boolean) {
  const u = await guard(personId, "diary");
  if (taken) await takeSupplement(db(), personId, u.id, uuid.parse(scheduleId), day.parse(date));
  else await untakeSupplement(db(), personId, uuid.parse(scheduleId), day.parse(date));
  refresh();
}

/* ------------------------------- labs ------------------------------- */

const LabRow = z.object({ parameterCode: z.string().max(40).nullish(), rawName: z.string().max(120), value: z.number(), unit: z.string().max(20), refLow: z.number().nullish(), refHigh: z.number().nullish() });

/** Confirm the (possibly edited) AI extraction of a lab report. */
export async function confirmLabReport(personId: string, reportId: string, input: { date: string; labName?: string | null; rows: z.input<typeof LabRow>[] }) {
  await guard(personId, "labs");
  const rows = z.array(LabRow).max(200).parse(input.rows);
  const date = day.parse(input.date);
  await db().transaction(async (tx) => {
    await tx.update(labReports).set({ date, labName: input.labName ?? null, status: "confirmed" }).where(and(eq(labReports.id, uuid.parse(reportId)), eq(labReports.personId, personId)));
    await tx.delete(labResults).where(eq(labResults.reportId, reportId));
    if (rows.length)
      await tx.insert(labResults).values(
        rows.map((r) => ({
          reportId,
          personId,
          date,
          parameterCode: r.parameterCode ?? null,
          rawName: r.rawName,
          value: r.value,
          unit: r.unit,
          refLow: r.refLow ?? null,
          refHigh: r.refHigh ?? null,
          flag: r.refLow != null && r.value < r.refLow ? "low" : r.refHigh != null && r.value > r.refHigh ? "high" : "normal",
        })),
      );
  });
  refresh();
}

export async function deleteLabReport(personId: string, id: string) {
  await guard(personId, "labs");
  await db().delete(labReports).where(and(eq(labReports.id, uuid.parse(id)), eq(labReports.personId, personId)));
  refresh();
}

/* ------------------------------ targets ------------------------------ */

export async function saveTargets(personId: string, input: { id?: string; name: string; kcal: number; protein: number; carbs: number; fat: number; fiber?: number | null; mode: "fixed" | "dynamic" | "adaptive"; pinned: string[]; rule?: { days?: number[]; trainingDay?: boolean } }) {
  await guard(personId, "diary");
  const v = z
    .object({
      id: uuid.optional(),
      name: z.string().min(1).max(40),
      kcal: z.number().min(500).max(8000),
      protein: z.number().min(0).max(600),
      carbs: z.number().min(0).max(1200),
      fat: z.number().min(0).max(400),
      fiber: z.number().min(0).max(150).nullish(),
      mode: z.enum(["fixed", "dynamic", "adaptive"]),
      pinned: z.array(z.enum(["kcal", "protein", "carbs", "fat"])).max(4),
      rule: z.object({ days: z.array(z.number().int().min(1).max(7)).optional(), trainingDay: z.boolean().optional() }).optional(),
    })
    .parse(input);
  const values = { name: v.name, kcal: v.kcal, protein: v.protein, carbs: v.carbs, fat: v.fat, fiber: v.fiber ?? null, mode: v.mode, pinned: v.pinned, source: "manual", rule: v.rule ?? {} };
  if (v.id) await db().update(targetSets).set(values).where(and(eq(targetSets.id, v.id), eq(targetSets.personId, personId)));
  else await db().insert(targetSets).values({ personId, ...values, isDefault: !v.rule?.days?.length && v.rule?.trainingDay === undefined });
  refresh();
}

export async function deleteTargetSet(personId: string, id: string) {
  await guard(personId, "diary");
  await db().delete(targetSets).where(and(eq(targetSets.id, uuid.parse(id)), eq(targetSets.personId, personId), eq(targetSets.isDefault, false)));
  refresh();
}

/** Explicit "Recalcular": says what is missing instead of silently doing nothing. */
export async function recalcTargets(personId: string) {
  await guard(personId, "diary");
  const missing = await missingProfileFields(db(), personId);
  if (missing.length) throw new UserError(`Para calcular los objetivos falta: ${missing.join(", ")}. Complétalo en Ajustes → Perfil.`);
  const [before] = await db().select({ mode: targetSets.mode }).from(targetSets).where(and(eq(targetSets.personId, personId), eq(targetSets.isDefault, true))).limit(1);
  const t = await recomputeTargets(db(), personId, { force: true });
  if (!t) throw new UserError("No se pudieron calcular los objetivos");
  refresh();
  return { kcal: Math.round(t.kcal), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat), wasFixed: before?.mode === "fixed", adaptive: t.source === "adaptive" };
}
