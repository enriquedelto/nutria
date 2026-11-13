/** Weekly coach report: gathers the week (adherence, bulk review, training, supplements, measurements) and stores it. */
import { and, between, bodyMeasurements, dailySummaries, diaryEntries, eq, exerciseLogs, gte, insights, persons, sql, type Database } from "@nutria/db";
import { weeklyReport, type AiProvider } from "@nutria/ai";
import { ACCESS_SCOPES } from "@nutria/db";
import { addDays, countsForAverages, dayLogStatus, isoDow, mealProteinStatus, proteinDoseG, todayIn, weekStart, SITE_LABEL } from "@nutria/nutrition";
import { latestBulkReview } from "./bulk";
import { leanMassStatus } from "./lean-mass";
import { notify, webhooksFor } from "./notify";
import { latestWeight, targetsForDate } from "./targets";

const FULL = new Set<string>(ACCESS_SCOPES);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The week a report run covers: the current one on Sundays (it runs at 20:00), otherwise the last complete one. */
export function reportWeekStart(today: string) {
  return isoDow(today) === 7 ? weekStart(today) : addDays(weekStart(today), -7);
}

/** Facts of the week the AI package cannot compute itself (it does not depend on core). */
export async function weeklyReportExtras(db: Database, personId: string, start: string) {
  const end = addDays(start, 6);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const [targets, w, meals, workouts, sups, measures, bulk, summaries, lean] = await Promise.all([
    Promise.all(dates.map(async (d) => ({ date: d, t: await targetsForDate(db, personId, d) }))),
    latestWeight(db, personId),
    db
      .select({ date: diaryEntries.date, slot: diaryEntries.mealSlot, protein: sql<number>`sum(${diaryEntries.protein})::float`, kcal: sql<number>`sum(${diaryEntries.kcal})::float` })
      .from(diaryEntries)
      .where(and(eq(diaryEntries.personId, personId), between(diaryEntries.date, start, end)))
      .groupBy(diaryEntries.date, diaryEntries.mealSlot),
    db.select({ date: exerciseLogs.date, name: exerciseLogs.name, min: exerciseLogs.durationMin, volumeKg: exerciseLogs.volumeKg, sets: exerciseLogs.sets, details: exerciseLogs.details }).from(exerciseLogs).where(and(eq(exerciseLogs.personId, personId), between(exerciseLogs.date, start, end))),
    db
      .select({ name: diaryEntries.name, days: sql<number>`count(distinct ${diaryEntries.date})::int` })
      .from(diaryEntries)
      .where(and(eq(diaryEntries.personId, personId), between(diaryEntries.date, start, end), eq(diaryEntries.origin, "supplement")))
      .groupBy(diaryEntries.name),
    db.select({ date: bodyMeasurements.date, site: bodyMeasurements.site, cm: bodyMeasurements.cm }).from(bodyMeasurements).where(and(eq(bodyMeasurements.personId, personId), gte(bodyMeasurements.date, addDays(start, -35)))).orderBy(bodyMeasurements.date),
    latestBulkReview(db, personId),
    db
      .select({ date: dailySummaries.date, kcal: dailySummaries.kcal, entries: dailySummaries.entries, complete: dailySummaries.complete, incomplete: dailySummaries.incomplete })
      .from(dailySummaries)
      .where(and(eq(dailySummaries.personId, personId), between(dailySummaries.date, start, end))),
    leanMassStatus(db, personId, new Date(`${end}T20:00:00Z`)),
  ]);

  const byDay = new Map<string, { kcal: number; protein: number }>();
  for (const m of meals) {
    const d = byDay.get(m.date) ?? { kcal: 0, protein: 0 };
    byDay.set(m.date, { kcal: d.kcal + m.kcal, protein: d.protein + m.protein });
  }
  // Partly logged days (marked, or under half the target) would read as under-eating: leave them out.
  const status = new Map(summaries.map((d) => [d.date, dayLogStatus(d, targets.find((x) => x.date === d.date)?.t?.kcal)]));
  const partial = [...status].filter(([, st]) => st === "incomplete" || st === "suspect").map(([date]) => date).sort();
  const logged = targets.filter((x) => x.t && byDay.has(x.date) && countsForAverages(status.get(x.date) ?? "normal"));
  const kcalOk = logged.filter((x) => Math.abs(byDay.get(x.date)!.kcal - x.t!.kcal) <= x.t!.kcal * 0.1).length;
  const proteinOk = logged.filter((x) => byDay.get(x.date)!.protein >= x.t!.protein * 0.9).length;
  const dose = w ? proteinDoseG(w.kg) : null;
  const mainMeals = meals.filter((m) => ["breakfast", "lunch", "dinner"].includes(m.slot) && !partial.includes(m.date));

  const sites = new Map<string, { first: number; last: number; n: number }>();
  for (const m of measures) {
    const s = sites.get(m.site);
    sites.set(m.site, s ? { ...s, last: m.cm, n: s.n + 1 } : { first: m.cm, last: m.cm, n: 1 });
  }
  const b = bulk && bulk.periodEnd && bulk.periodEnd >= addDays(start, -1) ? bulk.data : null;

  return {
    adherencia: {
      diasRegistrados: byDay.size,
      diasValidos: logged.length, // logged and trusted: the base of the two counts below
      diasIncompletos: partial, // marked as partial or under half the target: not in averages
      diasEnKcal: kcalOk, // within ±10 % of that day's target
      diasConProteina: proteinOk, // ≥ 90 % of the target
      objetivoPorDia: targets.filter((x) => x.t).map((x) => ({ date: x.date, kcal: Math.round(x.t!.kcal), protein: Math.round(x.t!.protein), tipo: x.t!.dayKind === "training" ? "entreno" : x.t!.dayKind === "rest" ? "descanso" : null })),
      proteinaPorComida: dose && mainMeals.length ? { tomaIdealG: dose, comidasPrincipales: mainMeals.length, llegan: mainMeals.filter((m) => mealProteinStatus(m.protein, dose) === "ok").length } : null,
    },
    entrenos: {
      sesiones: workouts.length,
      minutos: Math.round(workouts.reduce((a, x) => a + x.min, 0)),
      volumenKg: Math.round(workouts.reduce((a, x) => a + (x.volumeKg ?? 0), 0)),
      series: workouts.reduce((a, x) => a + (x.sets ?? 0), 0),
      records: [...new Set(workouts.flatMap((x) => (Array.isArray(x.details.prs) ? (x.details.prs as string[]) : [])))],
    },
    suplementos: sups.map((s) => ({ nombre: s.name, diasTomado: s.days })),
    medidas: [...sites].filter(([, v]) => v.n >= 2).map(([site, v]) => ({ zona: SITE_LABEL[site] ?? site, cm: v.last, cambioCm5Semanas: r1(v.last - v.first) })),
    masaMagra: lean && lean.check.level !== "unknown" ? { nivel: lean.check.level, motivos: lean.check.reasons, entrenosHechos4Sem: lean.sessionsLast28, planificadosPorSemana: lean.plannedPerWeek, fuerzaPct: lean.strengthPct, pesoCambio4SemKg: lean.weightChangeKg, cinturaCambioCm: lean.waistChangeCm } : null,
    volumen: b ? { veredicto: b.verdict, ritmoObjetivoKgSem: b.targetRateKgWeek, ritmoRealKgSem: b.observedRateKgWeek, propuestaKcal: b.kcalDelta, señal: b.signal.text, seriesPorMusculo4Sem: Object.fromEntries(b.sets.map((s) => [s.muscle, s.avg4])), cambioFuerzaPct: b.strengthChangePct } : null,
  };
}

/**
 * Builds and stores the report of one person (replacing the same week's, if any), notifies and
 * returns the outgoing webhooks to deliver. Null when the week has no diary days.
 */
export async function buildWeeklyReport(db: Database, personId: string, provider: AiProvider, now = new Date()) {
  const [p] = await db.select({ userId: persons.userId, timezone: persons.timezone }).from(persons).where(eq(persons.id, personId)).limit(1);
  if (!p?.userId) return null;
  const start = reportWeekStart(todayIn(p.timezone, now));
  const end = addDays(start, 6);
  const extras = await weeklyReportExtras(db, personId, start);
  const r = await weeklyReport({ db, userId: p.userId, personId, scopes: FULL, provider }, start, extras);
  if (!r) return null;
  const bodyMd = `${r.summaryMd}\n\n**Destacado**\n${r.highlights.map((h) => `- ${h}`).join("\n")}\n\n**Para la próxima semana**\n${r.suggestions.map((s) => `- ${s}`).join("\n")}`;
  await db.transaction(async (tx) => {
    await tx.delete(insights).where(and(eq(insights.personId, personId), eq(insights.kind, "weekly"), eq(insights.periodStart, start)));
    await tx.insert(insights).values({ personId, kind: "weekly", title: r.title, bodyMd, data: { ...r.data, cambio: r.oneChange } as Record<string, unknown>, periodStart: start, periodEnd: end });
  });
  await notify(db, { userId: p.userId, type: "weekly_report", title: `📊 ${r.title}`, body: r.oneChange ? `Un cambio para esta semana: ${r.oneChange}` : (r.highlights[0] ?? ""), url: "/progreso/informe", timezone: p.timezone });
  const hooks = await webhooksFor(db, p.userId, "report.weekly");
  return { title: r.title, oneChange: r.oneChange, webhooks: hooks.map((h) => ({ webhookId: h.id, event: "report.weekly", payload: { personId, weekStart: start, weekEnd: end, title: r.title, oneChange: r.oneChange, highlights: r.highlights, suggestions: r.suggestions, summaryMd: r.summaryMd } })) };
}
