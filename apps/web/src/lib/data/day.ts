import "server-only";
import { and, asc, desc, diaryEntries, eq, exerciseLogs, fastingSessions, isNull, medicationDoses, medications, mealSlots, persons, sql, stepLogs, streaks, waterLogs, weightLogs } from "@nutria/db";
import { getSportProfile, latestWeight, supplementsForDate, targetsForDate, templateSuggestions, trainingDayPlan, waterGoalFor } from "@nutria/core";
import { addDays, CORE_MICROS, computeMicroTargets, ageFromBirthDate, proteinDoseG, sumNutrients, todayIn, type NutrientMap } from "@nutria/nutrition";
import { db } from "../db";

export type DayEntry = typeof diaryEntries.$inferSelect;

export async function getDay(personId: string, date: string) {
  const d = db();
  const [person] = await d.select().from(persons).where(eq(persons.id, personId)).limit(1);
  const [slots, entries, water, target, exercise, steps, waterGoal, sport, weight] = await Promise.all([
    d.select().from(mealSlots).where(eq(mealSlots.personId, personId)).orderBy(asc(mealSlots.sortOrder)),
    d.select().from(diaryEntries).where(and(eq(diaryEntries.personId, personId), eq(diaryEntries.date, date))).orderBy(asc(diaryEntries.createdAt)),
    d.select({ ml: sql<number>`coalesce(sum(${waterLogs.ml}),0)::int` }).from(waterLogs).where(and(eq(waterLogs.personId, personId), eq(waterLogs.date, date))),
    targetsForDate(d, personId, date),
    d.select({ kcal: sql<number>`coalesce(sum(${exerciseLogs.kcal}),0)::float`, n: sql<number>`count(*)::int`, min: sql<number>`coalesce(sum(${exerciseLogs.durationMin}),0)::int`, names: sql<string[]>`coalesce(array_agg(${exerciseLogs.name} order by ${exerciseLogs.startedAt} nulls last), '{}')` }).from(exerciseLogs).where(and(eq(exerciseLogs.personId, personId), eq(exerciseLogs.date, date))),
    d.select({ steps: stepLogs.steps, kcal: stepLogs.kcal }).from(stepLogs).where(and(eq(stepLogs.personId, personId), eq(stepLogs.date, date))).limit(1),
    waterGoalFor(d, personId, date),
    getSportProfile(d, personId),
    latestWeight(d, personId),
  ]);
  const totals: NutrientMap = sumNutrients(entries.map((e) => ({ ...e.nutrients, energy_kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat, fiber: e.fiber })));
  const bySlot = new Map<string, DayEntry[]>();
  for (const e of entries) bySlot.set(e.mealSlot, [...(bySlot.get(e.mealSlot) ?? []), e]);
  // Entries whose slot was deleted still show up under "Otros".
  const known = new Set(slots.map((s) => s.key));
  const orphan = entries.filter((e) => !known.has(e.mealSlot));
  const meals = [
    ...slots.map((s) => ({ key: s.key, label: s.label, time: s.defaultTime, main: s.kcalShare == null ? !/snack/.test(s.key) : s.kcalShare >= 0.2, entries: bySlot.get(s.key) ?? [] })),
    ...(orphan.length ? [{ key: "other", label: "Otros", time: null, main: false, entries: orphan }] : []),
  ];
  const settings = person?.settings ?? {};
  const age = person?.birthDate ? ageFromBirthDate(person.birthDate) : 35;
  const microTargets = computeMicroTargets({ sex: person?.sex ?? "female", age, pregnancy: (person?.pregnancy ?? null) as never }, target?.kcal ?? 2000);
  return {
    person: person!,
    date,
    meals,
    entries,
    totals,
    target,
    /** Ideal protein per main meal (0.4 g/kg, min 25 g) for people training or gaining; null otherwise. */
    proteinDose: weight && (sport.active || person?.goalType === "gain") ? proteinDoseG(weight.kg) : null,
    microTargets,
    trackedMicros: settings.trackedMicros?.length ? settings.trackedMicros : CORE_MICROS.slice(0, 8),
    waterMl: water[0]?.ml ?? 0,
    waterGoalMl: waterGoal.ml,
    waterGoalAuto: waterGoal.auto,
    exerciseKcal: exercise[0]?.kcal ?? 0,
    exerciseCount: exercise[0]?.n ?? 0,
    exerciseMin: exercise[0]?.min ?? 0,
    exerciseNames: exercise[0]?.names ?? [],
    steps: steps[0] ?? null,
    energyUnit: settings.energyUnit ?? "kcal",
  };
}

export type DayData = Awaited<ReturnType<typeof getDay>>;

/** Extra cards for "Hoy": weight, streak, fasting, medication. Scope-filtered by the caller. */
export async function getHomeExtras(personId: string, timezone: string, scopes: Set<string>) {
  const d = db();
  const today = todayIn(timezone);
  const [weights, streak, fasting, meds, supplements, training, yesterdaySlots, suggestions] = await Promise.all([
    scopes.has("body") ? d.select({ date: weightLogs.date, kg: weightLogs.kg }).from(weightLogs).where(eq(weightLogs.personId, personId)).orderBy(desc(weightLogs.date)).limit(14) : Promise.resolve([]),
    d.select().from(streaks).where(and(eq(streaks.personId, personId), eq(streaks.kind, "logging"))).limit(1),
    d.select().from(fastingSessions).where(and(eq(fastingSessions.personId, personId), isNull(fastingSessions.endedAt))).orderBy(desc(fastingSessions.startedAt)).limit(1),
    scopes.has("medication")
      ? d
          .select({ id: medicationDoses.id, scheduledAt: medicationDoses.scheduledAt, status: medicationDoses.status, name: medications.name, dose: medications.dose, withFood: medications.withFood })
          .from(medicationDoses)
          .innerJoin(medications, eq(medications.id, medicationDoses.medicationId))
          .where(and(eq(medicationDoses.personId, personId), sql`(${medicationDoses.scheduledAt} at time zone ${timezone})::date = ${today}::date`))
          .orderBy(asc(medicationDoses.scheduledAt))
      : Promise.resolve([]),
    supplementsForDate(d, personId, today),
    trainingDayPlan(d, personId),
    d.selectDistinct({ slot: diaryEntries.mealSlot }).from(diaryEntries).where(and(eq(diaryEntries.personId, personId), eq(diaryEntries.date, addDays(today, -1)), sql`${diaryEntries.origin} <> 'supplement'`)),
    templateSuggestions(d, personId, today),
  ]);
  return { today, training, yesterdaySlots: yesterdaySlots.map((y) => y.slot), templateSuggestion: suggestions[0] ?? null, weights: weights.reverse(), streak: streak[0] ?? null, fasting: fasting[0] ?? null, meds, supplements: supplements.filter((s) => s.scheduledToday || s.taken) };
}
