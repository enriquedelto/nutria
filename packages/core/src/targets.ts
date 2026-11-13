/** Targets (formula + conditions), adaptive TDEE and forecast persistence. */
import { and, asc, dailySummaries, desc, eq, exerciseLogs, gte, personConditions, persons, targetSets, tdeeEstimates, weightLogs, type Database } from "@nutria/db";
import {
  addDays,
  adaptiveTdee,
  ageFromBirthDate,
  applyConditions,
  bmr,
  computeMacroTargets,
  computeMicroTargets,
  isoDow,
  rebalanceMacros,
  sportProfile,
  todayIn,
  type DayTargets,
  type PersonProfile,
} from "@nutria/nutrition";
import { dayKindFor, getSportProfile, personToday, sportDayVariants, type DayKind } from "./sport";

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

/** Profile fields the formulas still need (Spanish labels, empty when complete). */
export async function missingProfileFields(db: Database, personId: string) {
  const [p] = await db.select({ sex: persons.sex, birthDate: persons.birthDate, heightCm: persons.heightCm }).from(persons).where(eq(persons.id, personId)).limit(1);
  if (!p) return ["persona"];
  const w = await latestWeight(db, personId);
  return [!p.sex && "sexo", !p.birthDate && "fecha de nacimiento", !p.heightCm && "altura", !w && "peso"].filter((x): x is string => !!x);
}

/** Blend a stored estimate with the formula exactly like adaptiveTdee() does (= the suggested kcal). */
export function blendedTdee(e: { adaptiveTdee: number | null; confidence: number; underLoggingSuspected: boolean }, formulaTdee: number, bmrKcal: number) {
  if (e.adaptiveTdee == null) return formulaTdee;
  const conf = e.underLoggingSuspected ? e.confidence * 0.3 : e.confidence;
  const plausible = Math.min(Math.max(e.adaptiveTdee, bmrKcal), formulaTdee * 1.6);
  return Math.round(conf * plausible + (1 - conf) * formulaTdee);
}

/** TDEE from the latest confident adaptive estimate (≤ 21 days old), blended like the weekly job. */
async function recentAdaptiveTdee(db: Database, personId: string, formulaTdee: number, bmrKcal: number) {
  const [e] = await db.select().from(tdeeEstimates).where(eq(tdeeEstimates.personId, personId)).orderBy(desc(tdeeEstimates.date)).limit(1);
  if (!e || e.adaptiveTdee == null || e.confidence < 0.5 || Date.now() - Date.parse(e.date) > 21 * 86_400_000) return undefined;
  return blendedTdee(e, formulaTdee, bmrKcal);
}

/** Apply a weekly estimate: the same TDEE the suggestion showed (blended, not the raw adaptive value). */
export async function acceptTdeeEstimate(db: Database, personId: string, estimateId: string) {
  const [e] = await db.select().from(tdeeEstimates).where(and(eq(tdeeEstimates.id, estimateId), eq(tdeeEstimates.personId, personId))).limit(1);
  const pp = await personProfile(db, personId);
  if (!e?.adaptiveTdee || !pp) return null;
  const f = computeMacroTargets(pp.profile);
  const blended = blendedTdee(e, e.formulaTdee ?? f.tdee, f.bmr);
  const [cur] = await db.select({ mode: targetSets.mode }).from(targetSets).where(and(eq(targetSets.personId, personId), eq(targetSets.isDefault, true))).limit(1);
  // In mode "adaptive" the weekly job keeps it up to date; otherwise keep it as an adjustment over
  // the formula, so the next recompute (e.g. a weigh-in) does not drop it.
  const t =
    cur?.mode === "adaptive"
      ? await recomputeTargets(db, personId, { overrideTdee: blended, source: "adaptive", kcalAdjust: 0 })
      : await recomputeTargets(db, personId, { kcalAdjust: blended - f.tdee, source: "adaptive" });
  await db.update(tdeeEstimates).set({ acceptedAt: new Date() }).where(eq(tdeeEstimates.id, e.id));
  return t;
}

/**
 * (Re)compute the default target set from formulas + active conditions. Respects mode "fixed"
 * (manual targets are never overwritten unless `force`, which switches them back to calculated),
 * mode "adaptive" (keeps using the latest real-TDEE estimate) and pinned macros.
 */
export async function recomputeTargets(db: Database, personId: string, opts: { overrideTdee?: number; source?: "formula" | "adaptive"; force?: boolean; kcalAdjust?: number } = {}) {
  const pp = await personProfile(db, personId);
  if (!pp) return null;
  const [current] = await db.select().from(targetSets).where(and(eq(targetSets.personId, personId), eq(targetSets.isDefault, true))).limit(1);
  if (current?.mode === "fixed" && !opts.force) return current;
  if (current?.mode === "adaptive" && opts.overrideTdee == null) {
    const f = computeMacroTargets(pp.profile);
    const tdeeReal = await recentAdaptiveTdee(db, personId, f.tdee, f.bmr);
    if (tdeeReal != null) opts = { ...opts, overrideTdee: tdeeReal, source: "adaptive" };
  }
  const conds = await db.select({ code: personConditions.conditionCode, config: personConditions.config }).from(personConditions).where(and(eq(personConditions.personId, personId), eq(personConditions.active, true)));
  // Accepted adjustment (TDEE suggestion or bulk review) on top of the expenditure, kept across recomputes.
  const kcalAdjust = Math.round(opts.kcalAdjust ?? current?.kcalAdjust ?? 0);
  const baseTdee = opts.overrideTdee ?? (kcalAdjust ? computeMacroTargets(pp.profile).tdee : undefined);
  const macros = computeMacroTargets(pp.profile, baseTdee == null ? undefined : baseTdee + kcalAdjust);
  let micros = computeMicroTargets(pp.profile, macros.kcal);
  let t: DayTargets = { kcal: macros.kcal, protein: macros.protein, carbs: macros.carbs, fat: macros.fat, fiber: macros.fiber, micros };
  t = applyConditions(t, conds, pp.profile.weightKg);
  micros = t.micros;
  let main = { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat };
  if (current?.pinned.length) {
    const pinnedVals = { ...main, ...Object.fromEntries(current.pinned.map((k) => [k, current[k as "protein" | "carbs" | "fat"]])) };
    main = rebalanceMacros(pinnedVals, t.kcal, current.pinned);
  }
  const values = { ...main, fiber: t.fiber, micros, kcalAdjust, source: conds.length ? "condition" : kcalAdjust && !opts.source ? (current?.source ?? "adaptive") : (opts.source ?? "formula") };
  if (current) {
    const [u] = await db
      .update(targetSets)
      .set({ ...values, ...(current.mode === "fixed" ? { mode: "dynamic" } : {}) })
      .where(eq(targetSets.id, current.id))
      .returning();
    return u!;
  }
  const [n] = await db.insert(targetSets).values({ personId, name: "Diario", isDefault: true, mode: "dynamic", ...values }).returning();
  return n!;
}

/** Adaptive TDEE over the 28 days up to yesterday (shared by the weekly TDEE job and the bulk review). */
export async function adaptiveSnapshot(db: Database, personId: string, now = new Date()) {
  const pp = await personProfile(db, personId);
  if (!pp) return null;
  const today = todayIn(pp.person.timezone, now);
  const end = addDays(today, -1);
  const from = addDays(end, -45);
  const [days, weights] = await Promise.all([
    db.select({ date: dailySummaries.date, kcal: dailySummaries.kcal, entries: dailySummaries.entries, complete: dailySummaries.complete, incomplete: dailySummaries.incomplete }).from(dailySummaries).where(and(eq(dailySummaries.personId, personId), gte(dailySummaries.date, from))).orderBy(asc(dailySummaries.date)),
    db.select({ date: weightLogs.date, kg: weightLogs.kg }).from(weightLogs).where(and(eq(weightLogs.personId, personId), gte(weightLogs.date, from))).orderBy(asc(weightLogs.date)),
  ]);
  const byDate = new Map<string, { date: string; intakeKcal?: number | null; weightKg?: number | null; complete?: boolean }>();
  // Days marked as partly logged say nothing about real intake (their weight still counts).
  for (const d of days) if (d.entries > 0 && !d.incomplete) byDate.set(d.date, { date: d.date, intakeKcal: d.kcal, complete: d.complete });
  for (const w of weights) byDate.set(w.date, { ...(byDate.get(w.date) ?? { date: w.date }), weightKg: w.kg });
  const formula = computeMacroTargets(pp.profile);
  const r = adaptiveTdee([...byDate.values()], end, { formulaTdee: formula.tdee, bmr: bmr(pp.profile) });
  return { pp, today, end, formula, r };
}

/**
 * Weekly adaptive TDEE: blends observed energy balance (intake vs. trend weight) with the
 * formula, stores a snapshot, and suggests new kcal (applied automatically only in mode "adaptive").
 */
export async function weeklyAdaptiveTdee(db: Database, personId: string, now = new Date()) {
  const snap = await adaptiveSnapshot(db, personId, now);
  if (!snap) return null;
  const { pp, today, formula, r } = snap;
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

/**
 * Target set that applies on a date: a non-default set whose rule matches (weekday list or
 * training day), otherwise the default set — split into training/rest variants when the sport
 * profile has carb cycling on. Training day = workout logged, or a planned day (today onwards).
 */
export async function targetsForDate(db: Database, personId: string, date: string): Promise<(typeof targetSets.$inferSelect & { dayKind: DayKind | null }) | null> {
  const sets = await db.select().from(targetSets).where(eq(targetSets.personId, personId)).orderBy(desc(targetSets.isDefault));
  if (!sets.length) return null;
  const dow = isoDow(date);
  const sport = await getSportProfile(db, personId);
  const sp = sport.active ? sport.profile : sportProfile({});
  let kind: DayKind | null = null;
  const kindOf = async () => {
    if (kind) return kind;
    const logged = (await db.select({ id: exerciseLogs.id }).from(exerciseLogs).where(and(eq(exerciseLogs.personId, personId), eq(exerciseLogs.date, date))).limit(1)).length > 0;
    kind = dayKindFor(date, await personToday(db, personId), logged, sp);
    return kind;
  };
  for (const s of sets.filter((x) => !x.isDefault)) {
    if (s.rule.days?.length && !s.rule.days.includes(dow)) continue;
    if (s.rule.trainingDay !== undefined && s.rule.trainingDay !== ((await kindOf()) === "training")) continue;
    if (s.rule.days?.length || s.rule.trainingDay !== undefined) return { ...s, dayKind: s.rule.trainingDay !== undefined ? await kindOf() : null };
  }
  const def = sets.find((s) => s.isDefault) ?? sets[0]!;
  const variants = sport.active ? sportDayVariants(def, sp) : null;
  if (!variants) return { ...def, dayKind: null };
  const k = await kindOf();
  return { ...variants[k], dayKind: k };
}
