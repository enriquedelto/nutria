/** Weekly symptom ↔ food correlations (stored as insights; AI explains the strongest ones). */
import { and, diaryEntries, eq, foods, gte, inArray, insights, recipeIngredients, symptomLogs, type Database } from "@nutria/db";
import { explainCorrelation, type AiProvider } from "@nutria/ai";
import { ingredientKey, symptomCorrelations, type ExposureEvent } from "@nutria/nutrition";

/** Exposure keys for an entry: the food name key, its specific categories and allergens. */
function keysFor(e: { name: string; categories: string[] | null; allergens: string[] | null }): string[] {
  const keys = new Set<string>([ingredientKey(e.name)]);
  for (const c of e.categories ?? []) if (/^en:(dairies|milks|cheeses|wheat|breads|legumes|onions|garlic|coffees|alcoholic-beverages|sweeteners|fried-foods)/.test(c)) keys.add(c.replace(/^en:/, "cat:"));
  for (const a of e.allergens ?? []) keys.add(a.replace(/^en:/, "alergeno:"));
  return [...keys].filter(Boolean);
}

export async function runCorrelations(db: Database, input: { personId: string; userId: string; days?: number; provider?: AiProvider; explain?: boolean }) {
  const since = new Date(Date.now() - (input.days ?? 90) * 86_400_000);
  const sinceDate = since.toISOString().slice(0, 10);
  const entries = await db
    .select({ at: diaryEntries.eatenAt, date: diaryEntries.date, createdAt: diaryEntries.createdAt, name: diaryEntries.name, recipeId: diaryEntries.recipeId, categories: foods.categories, allergens: foods.allergens })
    .from(diaryEntries)
    .leftJoin(foods, eq(foods.id, diaryEntries.foodId))
    .where(and(eq(diaryEntries.personId, input.personId), gte(diaryEntries.date, sinceDate)));
  const syms = await db.select({ at: symptomLogs.occurredAt, symptom: symptomLogs.symptom, intensity: symptomLogs.intensity }).from(symptomLogs).where(and(eq(symptomLogs.personId, input.personId), gte(symptomLogs.occurredAt, since)));
  if (syms.length < 3) return [];
  const recipeIds = [...new Set(entries.map((e) => e.recipeId).filter((x): x is string => !!x))];
  const ingByRecipe = new Map<string, string[]>();
  const ings = recipeIds.length ? await db.select({ recipeId: recipeIngredients.recipeId, raw: recipeIngredients.rawText }).from(recipeIngredients).where(inArray(recipeIngredients.recipeId, recipeIds)) : [];
  for (const i of ings) ingByRecipe.set(i.recipeId, [...(ingByRecipe.get(i.recipeId) ?? []), ingredientKey(i.raw)]);
  const exposures: ExposureEvent[] = entries.flatMap((e) => {
    const at = (e.at ?? e.createdAt).getTime();
    const keys = [...keysFor(e), ...(e.recipeId ? (ingByRecipe.get(e.recipeId) ?? []) : [])];
    return keys.map((key) => ({ at, key }));
  });
  const found = symptomCorrelations(exposures, syms.map((s) => ({ at: s.at.getTime(), symptom: s.symptom, intensity: s.intensity })), { minExposures: 4 })
    .filter((c) => c.lift >= 1.5 && c.withSymptom >= 3)
    .slice(0, 5);
  // Replace previous correlation insights.
  await db.delete(insights).where(and(eq(insights.personId, input.personId), eq(insights.kind, "symptom_correlation")));
  for (const c of found) {
    let bodyMd = `Tras tomar **${c.key}**, apareció «${c.symptom}» en ${c.withSymptom} de ${c.exposures} ocasiones (${Math.round(c.rate * 100)} % frente a ${Math.round(c.baseline * 100)} % habitual). Es una correlación, no una causa.`;
    if (input.explain && input.provider) {
      try {
        bodyMd = await explainCorrelation({ db, userId: input.userId, provider: input.provider }, { exposure: c.key, symptom: c.symptom, ratio: c.lift, exposures: c.exposures, withSymptom: c.withSymptom, windowHours: [2, 24] });
      } catch {
        /* keep the plain explanation */
      }
    }
    await db.insert(insights).values({ personId: input.personId, kind: "symptom_correlation", title: `${c.key} → ${c.symptom}`, bodyMd, data: { ...c }, score: c.score, periodStart: sinceDate });
  }
  return found;
}
