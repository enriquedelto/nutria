/** Targets (formula + conditions), adaptive TDEE and forecast persistence. */
import { and, asc, dailySummaries, desc, eq, gte, personConditions, persons, targetSets, tdeeEstimates, weightLogs, type Database } from "@nutria/db";
import {
  addDays,
  adaptiveTdee,
  ageFromBirthDate,
  applyConditions,
  bmr,
  computeMacroTargets,
  computeMicroTargets,
  rebalanceMacros,
  todayIn,
  type DayTargets,
  type PersonProfile,
} from "@nutria/nutrition";

export async function latestWeight(db: Database, personId: string) {
  const [w] = await db.select({ kg: weightLogs.kg, bodyFatPct: weightLogs.bodyFatPct, date: weightLogs.date }).from(weightLogs).where(eq(weightLogs.personId, personId)).orderBy(desc(weightLogs.date), desc(weightLogs.measuredAt)).limit(1);
  return w ?? null;
}

/** Profile for formulas; null if essential data (sex, birth date, height, weight) is missing. */
export async function personProfile(db: Database, personId: string): Promise<{ profile: PersonProfile; person: typeof persons.$inferSelect } | null> {
  const [p] = await db.select().from(persons).where(eq(persons.id, personId)).limit(1);
  if (!p) return null;
  const w = await latestWeight(db, personId);
  if (!p.sex || !p.birthDate || !p.heightCm || !w) return null;
  return {
    person: p,
    profile: {
      sex: p.sex,
      age: ageFromBirthDate(p.birthDate),
      weightKg: w.kg,
      heightCm: p.heightCm,
      bodyFatPct: w.bodyFatPct,
      activityLevel: p.activityLevel,
      goalType: p.goalType,
      weeklyRateKg: p.weeklyRateKg,
      pregnancy: (p.pregnancy as PersonProfile["pregnancy"]) ?? null,
    },
  };
}

/**
 * (Re)compute the default target set from formulas + active conditions. Respects mode "fixed"
 * (manual targets are never overwritten) and pinned macros.
 */
export async function recomputeTargets(db: Database, personId: string, opts: { overrideTdee?: number; source?: "formula" | "adaptive" } = {}) {
  const pp = await personProfile(db, personId);
  if (!pp) return null;
  const [current] = await db.select().from(targetSets).where(and(eq(targetSets.personId, personId), eq(targetSets.isDefault, true))).limit(1);
  if (current?.mode === "fixed") return current;
  const conds = await db.select({ code: personConditions.conditionCode, config: personConditions.config }).from(personConditions).where(and(eq(personConditions.personId, personId), eq(personConditions.active, true)));
  const macros = computeMacroTargets(pp.profile, opts.overrideTdee);
  let micros = computeMicroTargets(pp.profile, macros.kcal);
  let t: DayTargets = { kcal: macros.kcal, protein: macros.protein, carbs: macros.carbs, fat: macros.fat, fiber: macros.fiber, micros };
  t = applyConditions(t, conds, pp.profile.weightKg);
  micros = t.micros;
  let main = { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat };
  if (current?.pinned.length) {
    const pinnedVals = { ...main, ...Object.fromEntries(current.pinned.map((k) => [k, current[k as "protein" | "carbs" | "fat"]])) };
    main = rebalanceMacros(pinnedVals, t.kcal, current.pinned);
  }
  const values = { ...main, fiber: t.fiber, micros, source: conds.length ? "condition" : (opts.source ?? "formula") };
  if (current) {
    const [u] = await db.update(targetSets).set(values).where(eq(targetSets.id, current.id)).returning();
    return u!;
  }
  const [n] = await db.insert(targetSets).values({ personId, name: "Diario", isDefault: true, mode: "dynamic", ...values }).returning();
  return n!;
}

/**
 * Weekly adaptive TDEE: blends observed energy balance (intake vs. trend weight) with the
 * formula, stores a snapshot, and suggests new kcal (applied automatically only in mode "adaptive").
 */
export async function weeklyAdaptiveTdee(db: Database, personId: string, now = new Date()) {
  const pp = await personProfile(db, personId);
  if (!pp) return null;
  const today = todayIn(pp.person.timezone, now);
  const end = addDays(today, -1);
  const from = addDays(end, -45);
  const [days, weights] = await Promise.all([
    db.select({ date: dailySummaries.date, kcal: dailySummaries.kcal, entries: dailySummaries.entries, complete: dailySummaries.complete }).from(dailySummaries).where(and(eq(dailySummaries.personId, personId), gte(dailySummaries.date, from))).orderBy(asc(dailySummaries.date)),
    db.select({ date: weightLogs.date, kg: weightLogs.kg }).from(weightLogs).where(and(eq(weightLogs.personId, personId), gte(weightLogs.date, from))).orderBy(asc(weightLogs.date)),
  ]);
  const byDate = new Map<string, { date: string; intakeKcal?: number | null; weightKg?: number | null; complete?: boolean }>();
  for (const d of days) if (d.entries > 0) byDate.set(d.date, { date: d.date, intakeKcal: d.kcal, complete: d.complete });
  for (const w of weights) byDate.set(w.date, { ...(byDate.get(w.date) ?? { date: w.date }), weightKg: w.kg });
  const formula = computeMacroTargets(pp.profile);
  const r = adaptiveTdee([...byDate.values()], end, { formulaTdee: formula.tdee, bmr: bmr(pp.profile) });
  const suggested = computeMacroTargets(pp.profile, r.estimatedTdee).kcal;
  const row = {
    personId,
    date: today,
    formulaTdee: formula.tdee,
    adaptiveTdee: r.adaptiveTdee,
    avgIntake: r.avgIntake,
    trendWeightStart: r.trendStart,
    trendWeightEnd: r.trendEnd,
    windowDays: r.windowDays,
    loggedDays: r.loggedDays,
    confidence: r.confidence,
    underLoggingSuspected: r.underLoggingSuspected,
    suggestedKcal: suggested,
  };
  await db.insert(tdeeEstimates).values(row).onConflictDoUpdate({ target: [tdeeEstimates.personId, tdeeEstimates.date], set: { ...row, updatedAt: new Date() } });
  const [current] = await db.select({ mode: targetSets.mode }).from(targetSets).where(and(eq(targetSets.personId, personId), eq(targetSets.isDefault, true))).limit(1);
  if (current?.mode === "adaptive" && r.confidence >= 0.5) await recomputeTargets(db, personId, { overrideTdee: r.estimatedTdee, source: "adaptive" });
  return { ...r, suggestedKcal: suggested };
}
