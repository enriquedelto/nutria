/** Daily aggregates (daily_summaries) — recomputed whenever the diary of a day changes. */
import { and, dailySummaries, diaryEntries, eq, exerciseLogs, targetSets, waterLogs, sql, type SQL, type Database } from "@nutria/db";
import { dailyQualityScore, macroColumns, NOVA_MIN_COVERAGE, SUSPECT_DAY_SHARE, novaCoverage, roundMap, sumNutrients, upfKcalPct } from "@nutria/nutrition";

export async function recomputeDay(db: Database, personId: string, date: string) {
  const entries = await db
    .select({ kcal: diaryEntries.kcal, nova: diaryEntries.nova, nutriscore: diaryEntries.nutriscore, nutrients: diaryEntries.nutrients })
    .from(diaryEntries)
    .where(and(eq(diaryEntries.personId, personId), eq(diaryEntries.date, date)));
  const totals = sumNutrients(entries.map((e) => e.nutrients));
  totals.energy_kcal = entries.reduce((s, e) => s + e.kcal, 0);
  const [target] = await db.select().from(targetSets).where(and(eq(targetSets.personId, personId), eq(targetSets.isDefault, true))).limit(1);
  const [water] = await db.select({ ml: sql<number>`coalesce(sum(${waterLogs.ml}), 0)::int` }).from(waterLogs).where(and(eq(waterLogs.personId, personId), eq(waterLogs.date, date)));
  const [ex] = await db.select({ kcal: sql<number>`coalesce(sum(${exerciseLogs.kcal}), 0)::float` }).from(exerciseLogs).where(and(eq(exerciseLogs.personId, personId), eq(exerciseLogs.date, date)));
  const m = macroColumns(totals);
  const row = {
    personId,
    date,
    ...m,
    nutrients: roundMap(totals, 3),
    entries: entries.length,
    // With little NOVA data the share describes a couple of foods, not the day: leave it out of averages.
    upfKcalPct: (novaCoverage(entries) ?? 0) >= NOVA_MIN_COVERAGE ? upfKcalPct(entries) : null,
    qualityScore: target
      ? dailyQualityScore(entries, totals, { kcal: target.kcal, fiber: target.fiber ?? undefined, salt: target.micros.salt?.max, sat_fat: target.micros.sat_fat?.max, added_sugars: target.micros.added_sugars?.max })
      : dailyQualityScore(entries, totals, { kcal: 2000 }),
    waterMl: water?.ml ?? 0,
    exerciseKcal: ex?.kcal ?? 0,
  };
  await db
    .insert(dailySummaries)
    .values(row)
    .onConflictDoUpdate({ target: [dailySummaries.personId, dailySummaries.date], set: { ...row, updatedAt: new Date() } });
  return row;
}

/**
 * SQL filter for daily summaries whose intake can be trusted (same rule as `dayLogStatus`): logged,
 * not marked as partial, and either marked complete or at least half the default kcal target.
 */
export function trustedDaySql(): SQL {
  return sql`(${dailySummaries.entries} > 0 and not ${dailySummaries.incomplete} and (${dailySummaries.complete} or ${dailySummaries.kcal} >= ${sql.raw(String(SUSPECT_DAY_SHARE))} * coalesce((select t.kcal from ${targetSets} t where t.person_id = ${dailySummaries.personId} and t.is_default limit 1), 0)))`;
}
