/**
 * High-level AI features. Each one: checks quota → builds context → calls the provider →
 * validates with zod → records usage → stores an ai_estimate (proposal) when it produces data
 * that the user must confirm. Nothing here writes diary/health tables directly.
 */
import type { z } from "zod";
import {
  aiConversations,
  aiEstimates,
  aiMessages,
  and,
  asc,
  between,
  dailySummaries,
  desc,
  eq,
  exerciseLogs,
  gte,
  insights,
  labParameters,
  pantryItems,
  portionMemory,
  recipeRatings,
  recipes,
  searchFoods,
  sleepLogs,
  sql,
  targetSets,
  tdeeEstimates,
  weightLogs,
  type Database,
} from "@nutria/db";
import { addDays, completeDerived, countsForAverages, DAY_STATUS_LABEL, dayLogStatus, formatDateEs, macroColumns, microGaps, missingFrom, round, scaleNutrients, type NutrientMap } from "@nutria/nutrition";
import { buildPersonContext, mealSlotName, portionKey } from "./context";
import { contextBlock, HEALTH_DISCLAIMER, PROMPTS } from "./prompts";
import { getProvider } from "./provider";
import { assertQuota, recordUsage } from "./quota";
import * as S from "./schemas";
import { toolsFor } from "./tools";
import { AiError, type AiContent, type AiProvider, type Effort, type Proposal, type ToolContext } from "./types";

export interface FeatureCtx {
  db: Database;
  userId: string;
  provider?: AiProvider;
  signal?: AbortSignal;
}
export interface PersonFeatureCtx extends FeatureCtx {
  personId: string;
  scopes: ReadonlySet<string>;
}

type Images = Extract<AiContent, { type: "image" }>[];

async function call<Sc extends z.ZodType>(
  c: FeatureCtx,
  feature: string,
  system: string,
  content: AiContent[],
  schema: Sc,
  effort: Effort = "medium",
): Promise<{ data: z.infer<Sc>; model: string }> {
  const provider = c.provider ?? getProvider();
  await assertQuota(c.db, c.userId, provider.backend);
  try {
    const { data, usage } = await provider.structured({ feature, system, content, schema, effort, signal: c.signal });
    await recordUsage(c.db, { userId: c.userId, feature, backend: provider.backend, usage });
    return { data, model: usage.model };
  } catch (e) {
    await recordUsage(c.db, { userId: c.userId, feature, backend: provider.backend, ok: e instanceof AiError ? e.code : "error" });
    throw e;
  }
}

async function saveEstimate(c: FeatureCtx, row: { personId?: string; kind: string; input: Record<string, unknown>; output: Record<string, unknown>; confidence?: number; model?: string }) {
  const [e] = await c.db.insert(aiEstimates).values({ userId: c.userId, ...row }).returning({ id: aiEstimates.id });
  return e!.id;
}

/* ----------------------------- meal logging ------------------------------ */

export interface MatchedItem extends S.MealItem {
  /** Best catalogue match (null → use the AI per100 estimate as a custom/AI food). */
  match: { foodId: string; name: string; brand: string | null; source: string } | null;
  candidates: { foodId: string; name: string; brand: string | null; kcal: number | null }[];
  /** Per-100 g AI values for nutrients the matched food lacks (kept when the entry is saved). */
  gaps: NutrientMap;
  /** Nutrients for the estimated grams (from the match if any, else from the AI estimate). */
  nutrients: NutrientMap;
  macros: ReturnType<typeof macroColumns>;
}

export interface MealEstimateResult {
  estimateId: string;
  mealSlot: string | null;
  items: MatchedItem[];
  notes: string | null;
  questions: string[];
  totals: ReturnType<typeof macroColumns>;
}

/**
 * Meal from text, voice transcript and/or photos (+ optional note). The result is stored as a
 * pending ai_estimate; the web confirms it into diary_entries (origin ai_text|ai_photo|ai_voice).
 */
export async function estimateMeal(
  c: PersonFeatureCtx,
  input: { text?: string; images?: Images; /** Photos of what was left on the plate (after eating). */ leftoverImages?: Images; mode: "text" | "voice" | "photo"; mealSlot?: string; date?: string; /** "HH:MM" when it was eaten. */ time?: string },
): Promise<MealEstimateResult> {
  const pc = await buildPersonContext(c.db, c.personId, c.scopes);
  const before = input.images ?? [];
  const after = input.leftoverImages ?? [];
  const content: AiContent[] = [
    ...before,
    ...(after.length
      ? [
          { type: "text" as const, text: `Fotos 1–${before.length}: el plato antes de comer.` },
          ...after,
          { type: "text" as const, text: `Fotos ${before.length + 1}–${before.length + after.length}: lo que sobró. Los gramos deben ser lo comido (lo de antes menos lo que sobró).` },
        ]
      : []),
    {
      type: "text",
      text: [
        contextBlock(pc.lines),
        input.mealSlot ? `Comida: ${mealSlotName(input.mealSlot)}.` : null,
        input.date && (input.date !== pc.today || input.time) ? `Se comió el ${formatDateEs(input.date)}${input.time ? ` a las ${input.time}` : ""}.` : null,
        before.length && !after.length ? `${before.length} foto(s) de la misma comida.` : null,
        input.text ? `Descripción${input.mode === "voice" ? " (dictada por voz)" : ""}: ${input.text}` : "Estima la comida de las fotos.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
  const feature = `meal_${input.mode}`;
  const { data, model } = await call(c, feature, PROMPTS.meal, content, S.MealEstimate, input.images?.length ? "medium" : "low");
  const items = await Promise.all(data.items.map((it) => matchItem(c.db, pc.groupId, it)));
  const totals = macroColumns(items.reduce<NutrientMap>((acc, i) => {
    for (const [k, v] of Object.entries(i.nutrients)) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {}));
  const estimateId = await saveEstimate(c, {
    personId: c.personId,
    kind: "meal",
    input: { mode: input.mode, text: input.text ?? null, photos: before.length, leftoverPhotos: after.length, mealSlot: input.mealSlot ?? null, date: input.date ?? pc.today, time: input.time ?? null },
    output: { ...data, items },
    confidence: items.length ? items.reduce((s, i) => s + i.confidence, 0) / items.length : 0,
    model,
  });
  return { estimateId, mealSlot: input.mealSlot ?? data.mealSlot ?? null, items, notes: data.notes ?? null, questions: data.questions, totals };
}

/** Catalogue kcal/100 g within max(20 kcal, 35 %) of the AI estimate (any value if there is no estimate). */
export function plausibleKcal(catalogKcal: number, aiKcal: number | undefined): boolean {
  if (aiKcal == null) return true;
  return Math.abs(catalogKcal - aiKcal) <= Math.max(20, aiKcal * 0.35);
}

async function matchItem(db: Database, groupId: string | null, it: S.MealItem): Promise<MatchedItem> {
  const hits = await searchFoods(db, it.brand ? `${it.searchQuery} ${it.brand}` : it.searchQuery, { groupId, limit: 5 });
  const aiPer100 = completeDerived(S.per100ToMap(it.per100));
  // First candidate whose energy density is plausible vs. the AI estimate (guards bad matches such
  // as a "café solo" with 42 kcal/100 g against a 2 kcal estimate).
  const best = hits.find((h) => h.kcal != null && plausibleKcal(h.kcal, aiPer100.energy_kcal)) ?? null;
  // Nutrients the catalogue food lacks but the AI estimated (typically caffeine) are kept.
  const gaps: NutrientMap = best ? missingFrom(best.nutrients, S.per100ToMap(it.per100)) : {};
  const per100 = best ? { ...gaps, ...best.nutrients, energy_kcal: best.kcal ?? best.nutrients.energy_kcal ?? 0 } : aiPer100;
  const nutrients = scaleNutrients(per100, it.grams);
  return {
    ...it,
    nova: it.nova != null && it.nova >= 1 && it.nova <= 4 ? Math.round(it.nova) : null,
    gaps,
    match: best ? { foodId: best.id, name: best.nameEs ?? best.name, brand: best.brand, source: best.source } : null,
    candidates: hits.map((h) => ({ foodId: h.id, name: h.nameEs ?? h.name, brand: h.brand, kcal: h.kcal })),
    nutrients,
    macros: macroColumns(nutrients),
  };
}

/** "What if?": totals of the day if a set of items were added (pure, no AI). */
export function whatIf(dayTotals: NutrientMap, items: { nutrients: NutrientMap }[], target: { kcal: number; protein: number; carbs: number; fat: number }) {
  const after = { ...dayTotals };
  for (const i of items) for (const [k, v] of Object.entries(i.nutrients)) after[k] = (after[k] ?? 0) + v;
  const m = macroColumns(after);
  return {
    after: m,
    remaining: { kcal: round(target.kcal - m.kcal, 0), protein: round(target.protein - m.protein), carbs: round(target.carbs - m.carbs), fat: round(target.fat - m.fat) },
    overKcal: m.kcal > target.kcal * 1.05,
  };
}

/* ------------------------------- label OCR ------------------------------- */

export async function readLabel(c: PersonFeatureCtx, images: Images) {
  const { data, model } = await call(c, "label", PROMPTS.label, [...images, { type: "text", text: "Lee la etiqueta." }], S.LabelReading, "medium");
  const per100 = completeDerived(S.per100ToMap(data.per100));
  const estimateId = await saveEstimate(c, { personId: c.personId, kind: "label", input: { photos: images.length }, output: { ...data, per100Map: per100 }, confidence: data.confidence, model });
  return { estimateId, ...data, per100: per100 };
}

/* ------------------------------ lab reports ------------------------------ */

export async function extractLabReport(c: PersonFeatureCtx, doc: { pdf?: string; images?: Images }) {
  const params = await c.db.select({ code: labParameters.code, nameEs: labParameters.nameEs, aliases: labParameters.aliases, unit: labParameters.unit }).from(labParameters);
  const list = params.map((p) => `${p.code}: ${p.nameEs}${p.aliases.length ? ` (${p.aliases.join(", ")})` : ""} [${p.unit}]`).join("\n");
  const content: AiContent[] = [
    ...(doc.pdf ? [{ type: "pdf" as const, data: doc.pdf }] : []),
    ...(doc.images ?? []),
    { type: "text", text: `Parámetros conocidos:\n${list}\n\nExtrae los resultados.` },
  ];
  const { data, model } = await call(c, "lab_report", PROMPTS.labReport, content, S.LabReportExtraction, "medium");
  const known = new Set(params.map((p) => p.code));
  const results = data.results.map((r) => ({
    ...r,
    parameterCode: r.parameterCode && known.has(r.parameterCode) ? r.parameterCode : null,
    flag: r.refLow != null && r.value < r.refLow ? "low" : r.refHigh != null && r.value > r.refHigh ? "high" : "normal",
  }));
  const estimateId = await saveEstimate(c, { personId: c.personId, kind: "lab_report", input: { pdf: !!doc.pdf, photos: doc.images?.length ?? 0 }, output: { ...data, results }, model });
  return { estimateId, ...data, results, disclaimer: HEALTH_DISCLAIMER };
}

/* -------------------------------- recipes -------------------------------- */

/** Structure a recipe from page text / video description + transcript. */
export async function structureRecipe(c: FeatureCtx, input: { text: string; sourceUrl?: string; sourceType: "url" | "video" | "text"; imageUrl?: string | null; estimateId?: string }) {
  const { data, model } = await call(c, "recipe_structure", PROMPTS.recipe, [{ type: "text", text: `${input.sourceUrl ? `Fuente: ${input.sourceUrl}\n\n` : ""}${input.text.slice(0, 60_000)}` }], S.RecipeStructure, "low");
  const output = { ...data, imageUrl: input.imageUrl ?? null, sourceUrl: input.sourceUrl ?? null };
  if (input.estimateId) {
    await c.db.update(aiEstimates).set({ output, status: "pending", model }).where(eq(aiEstimates.id, input.estimateId));
    return { estimateId: input.estimateId, ...output };
  }
  const estimateId = await saveEstimate(c, { kind: "recipe", input: { sourceUrl: input.sourceUrl ?? null, sourceType: input.sourceType }, output, model });
  return { estimateId, ...output };
}

export async function suggestSubstitutions(c: PersonFeatureCtx, input: { recipeTitle: string; ingredients: string[]; reason: string }) {
  const pc = await buildPersonContext(c.db, c.personId, c.scopes);
  const { data } = await call(c, "substitutions", PROMPTS.substitutions, [{ type: "text", text: `${contextBlock(pc.lines)}\n\nReceta: ${input.recipeTitle}\nIngredientes:\n- ${input.ingredients.join("\n- ")}\n\nMotivo: ${input.reason}` }], S.Substitutions, "low");
  return data;
}

/* --------------------------- CIQUAL translation -------------------------- */

/** Translate generic food names to Spanish in batches (worker job after CIQUAL import). */
export async function translateFoodNames(c: FeatureCtx, items: { id: string; name: string }[]) {
  const text = `Traduce:\n${items.map((i) => `- ${i.id}: ${i.name}`).join("\n")}`;
  const { data } = await call(c, "translate_foods", PROMPTS.translate, [{ type: "text", text }], S.FoodTranslations, "low");
  const ids = new Set(items.map((i) => i.id));
  return data.items.filter((i) => ids.has(i.id) && i.nameEs.trim());
}

/* ------------------------------- receipts -------------------------------- */

/** Receipt photo(s) or PDF → lines, store header and date for the review screen (household-scoped). */
export async function readReceipt(c: FeatureCtx & { groupId: string }, doc: { pdf?: string; images?: Images }) {
  const content: AiContent[] = [...(doc.pdf ? [{ type: "pdf" as const, data: doc.pdf }] : []), ...(doc.images ?? []), { type: "text", text: "Lee el ticket." }];
  const { data, model } = await call(c, "receipt", PROMPTS.receipt, content, S.ReceiptReading, "medium");
  const estimateId = await saveEstimate(c, { kind: "receipt", input: { groupId: c.groupId, pdf: !!doc.pdf, photos: doc.images?.length ?? 0 }, output: data, confidence: data.confidence, model });
  return { estimateId, ...data };
}

/* -------------------------------- pantry --------------------------------- */

export async function pantryFromPhoto(c: FeatureCtx & { groupId: string }, images: Images) {
  const { data, model } = await call(c, "pantry_photo", PROMPTS.pantryPhoto, [...images, { type: "text", text: "¿Qué alimentos hay?" }], S.PantryPhoto, "low");
  const estimateId = await saveEstimate(c, { kind: "pantry_photo", input: { groupId: c.groupId, photos: images.length }, output: data, model });
  return { estimateId, ...data };
}

/* ------------------------------ what to eat ------------------------------ */

export async function whatToEat(c: PersonFeatureCtx, input: { remaining: { kcal: number; protein: number; carbs: number; fat: number }; mealSlot?: string; maxMinutes?: number }) {
  const pc = await buildPersonContext(c.db, c.personId, c.scopes);
  const pantry = pc.groupId
    ? await c.db.select({ name: pantryItems.name, expiresOn: pantryItems.expiresOn }).from(pantryItems).where(eq(pantryItems.groupId, pc.groupId)).orderBy(sql`${pantryItems.expiresOn} asc nulls last`).limit(60)
    : [];
  const recs = pc.groupId
    ? await c.db.select({ id: recipes.id, title: recipes.title, kcal: recipes.kcalPerServing, protein: recipes.proteinPerServing, prepMin: recipes.prepMin }).from(recipes).where(eq(recipes.groupId, pc.groupId)).orderBy(desc(recipes.updatedAt)).limit(40)
    : [];
  const text = [
    contextBlock(pc.lines),
    `Me quedan hoy: ${Math.round(input.remaining.kcal)} kcal, ${Math.round(input.remaining.protein)} g proteína, ${Math.round(input.remaining.carbs)} g hidratos, ${Math.round(input.remaining.fat)} g grasa.`,
    input.mealSlot ? `Es para: ${mealSlotName(input.mealSlot)}.` : null,
    input.maxMinutes ? `Tiempo máximo: ${input.maxMinutes} min.` : null,
    pantry.length ? `Despensa: ${pantry.map((p) => (p.expiresOn ? `${p.name} (caduca ${p.expiresOn})` : p.name)).join(", ")}.` : null,
    recs.length ? `Recetas guardadas: ${recs.map((r) => `${r.title} [id ${r.id}${r.kcal ? `, ${Math.round(r.kcal)} kcal/ración` : ""}]`).join("; ")}.` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const { data } = await call(c, "what_to_eat", PROMPTS.whatToEat, [{ type: "text", text }], S.WhatToEat, "low");
  return data;
}

/* ------------------------------ meal planner ----------------------------- */

export async function generateMealPlan(
  c: FeatureCtx & { groupId: string },
  input: {
    personIds: string[];
    from: string;
    days: number;
    slots: string[];
    maxPrepMinWeekday?: number;
    budgetPerDay?: number;
    notes?: string;
    scopesByPerson: Record<string, ReadonlySet<string>>;
    /** Per person: the target of each planned day (training/rest) and the ideal protein per main meal. */
    dayTargets?: Record<string, { proteinPerMeal?: number | null; days: { date: string; kcal: number; protein: number; kind: "training" | "rest" | null }[] }>;
  },
) {
  const people = await Promise.all(
    input.personIds.map(async (id) => {
      const pc = await buildPersonContext(c.db, id, input.scopesByPerson[id] ?? new Set());
      const dt = input.dayTargets?.[id];
      const perDay = dt?.days.length
        ? `\nObjetivo por día: ${dt.days.map((d) => `${d.date}${d.kind ? ` (${d.kind === "training" ? "entreno" : "descanso"})` : ""} ${Math.round(d.kcal)} kcal, ${Math.round(d.protein)} g proteína`).join("; ")}.${dt.proteinPerMeal ? ` Proteína por comida principal: al menos ${dt.proteinPerMeal} g.` : ""}`
        : "";
      return `### ${pc.displayName} (id ${id})\n${pc.lines.slice(1).join("\n")}${perDay}`;
    }),
  );
  const pantry = await c.db.select({ name: pantryItems.name, quantity: pantryItems.quantity, unit: pantryItems.unit, expiresOn: pantryItems.expiresOn }).from(pantryItems).where(eq(pantryItems.groupId, c.groupId)).orderBy(sql`${pantryItems.expiresOn} asc nulls last`).limit(120);
  const recs = await c.db
    .select({ id: recipes.id, title: recipes.title, kcal: recipes.kcalPerServing, protein: recipes.proteinPerServing, fridgeDays: recipes.fridgeDays, freezable: recipes.freezable, prepMin: recipes.prepMin, cookMin: recipes.cookMin, tags: recipes.tags, cost: recipes.costPerServing, avgStars: sql<number | null>`(select avg(${recipeRatings.stars})::float from ${recipeRatings} where ${recipeRatings.recipeId} = ${recipes.id})`, dislikes: sql<number>`(select count(*)::int from ${recipeRatings} where ${recipeRatings.recipeId} = ${recipes.id} and (${recipeRatings.verdict} = 'dislike' or ${recipeRatings.notEaten}))` })
    .from(recipes)
    .where(eq(recipes.groupId, c.groupId))
    .limit(150);
  const text = [
    `Planifica ${input.days} días desde ${input.from} (comidas: ${input.slots.map(mealSlotName).join(", ")}).`,
    input.maxPrepMinWeekday ? `Entre semana, máximo ${input.maxPrepMinWeekday} min de preparación.` : null,
    input.budgetPerDay ? `Presupuesto aproximado: ${input.budgetPerDay} € al día para el hogar.` : null,
    input.notes ? `Indicaciones: ${input.notes}` : null,
    `## Personas\n${people.join("\n\n")}`,
    pantry.length ? `## Despensa\n${pantry.map((p) => `- ${p.name} ${p.quantity} ${p.unit}${p.expiresOn ? ` (caduca ${p.expiresOn})` : ""}`).join("\n")}` : null,
    recs.length ? `## Recetas guardadas\n${recs.map((r) => `- [${r.id}] ${r.title}${r.kcal ? ` · ${Math.round(r.kcal)} kcal/ración` : ""}${r.protein ? ` · ${Math.round(r.protein)} g proteína` : ""}${r.fridgeDays ? ` · nevera ${r.fridgeDays} d` : ""}${r.freezable ? " · congelable" : ""}${r.prepMin || r.cookMin ? ` · ${(r.prepMin ?? 0) + (r.cookMin ?? 0)} min` : ""}${r.avgStars ? ` · ${round(r.avgStars, 1)}★` : ""}${r.dislikes ? ` · ${r.dislikes} rechazo(s)` : ""}${r.cost ? ` · ${r.cost} €/ración${r.kcal && Number(r.cost) > 0 ? ` (${Math.round(r.kcal / Number(r.cost))} kcal/€)` : ""}` : ""}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const { data, model } = await call(c, "meal_plan", PROMPTS.planner, [{ type: "text", text }], S.MealPlanDraft, "high");
  const valid = new Set(recs.map((r) => r.id));
  const persons = new Set(input.personIds);
  const days = data.days.map((d) => ({
    ...d,
    meals: d.meals.map((m) => ({ ...m, recipeId: m.recipeId && valid.has(m.recipeId) ? m.recipeId : null, servingsByPerson: m.servingsByPerson.filter((s) => persons.has(s.personId)) })),
  }));
  const estimateId = await saveEstimate(c, { kind: "meal_plan", input: { ...input, scopesByPerson: undefined }, output: { ...data, days }, model });
  return { estimateId, days, notes: data.notes };
}

/** Weekly retrospective → updated household/person preference markdown (proposal). */
export async function summarizeRetro(c: FeatureCtx & { groupId: string }, input: { planId: string; feedback: string; household: string; perPerson: { personId: string; name: string; current: string }[] }) {
  const text = `Preferencias actuales del hogar:\n${input.household || "(vacío)"}\n\n${input.perPerson.map((p) => `### ${p.name} (id ${p.personId})\n${p.current || "(vacío)"}`).join("\n\n")}\n\n## Valoraciones de la semana\n${input.feedback}`;
  const { data, model } = await call(c, "retro_summary", PROMPTS.retro, [{ type: "text", text }], S.RetroSummary, "medium");
  const estimateId = await saveEstimate(c, { kind: "retro", input: { planId: input.planId }, output: data, model });
  return { estimateId, ...data };
}

/* ------------------------------ weekly report ---------------------------- */

export async function weeklyReport(c: PersonFeatureCtx, weekStartDate: string, extras: Record<string, unknown> = {}) {
  const end = addDays(weekStartDate, 6);
  const pc = await buildPersonContext(c.db, c.personId, c.scopes);
  const [target] = await c.db.select().from(targetSets).where(and(eq(targetSets.personId, c.personId), eq(targetSets.isDefault, true))).limit(1);
  const days = await c.db.select().from(dailySummaries).where(and(eq(dailySummaries.personId, c.personId), between(dailySummaries.date, weekStartDate, end))).orderBy(asc(dailySummaries.date));
  // Nothing logged that week: no report, and no AI call (it would be thrown away).
  if (!days.length) return null;
  const status = new Map(days.map((d) => [d.date, dayLogStatus(d, target?.kcal)]));
  // Partly logged days would show as gaps that are only missing entries.
  const trusted = days.filter((d) => countsForAverages(status.get(d.date)!));
  const gaps = target && trusted.length ? microGaps(trusted.map((d) => d.nutrients), Object.fromEntries(Object.entries(target.micros).map(([k, v]) => [k, { min: v.min, max: v.max }]))) : [];
  const body = c.scopes.has("body")
    ? {
        weights: await c.db.select({ date: weightLogs.date, kg: weightLogs.kg }).from(weightLogs).where(and(eq(weightLogs.personId, c.personId), gte(weightLogs.date, addDays(weekStartDate, -21)))).orderBy(asc(weightLogs.date)),
        tdee: (await c.db.select().from(tdeeEstimates).where(eq(tdeeEstimates.personId, c.personId)).orderBy(desc(tdeeEstimates.date)).limit(1))[0] ?? null,
        exercise: await c.db.select({ date: exerciseLogs.date, name: exerciseLogs.name, kcal: exerciseLogs.kcal, durationMin: exerciseLogs.durationMin }).from(exerciseLogs).where(and(eq(exerciseLogs.personId, c.personId), between(exerciseLogs.date, weekStartDate, end))),
      }
    : null;
  const health = c.scopes.has("health")
    ? {
        sleep: await c.db.select({ date: sleepLogs.date, hours: sleepLogs.hours, quality: sleepLogs.quality }).from(sleepLogs).where(and(eq(sleepLogs.personId, c.personId), between(sleepLogs.date, weekStartDate, end))),
        insights: await c.db.select({ kind: insights.kind, title: insights.title }).from(insights).where(and(eq(insights.personId, c.personId), gte(insights.createdAt, new Date(Date.parse(weekStartDate) - 7 * 86_400_000)))).limit(10),
      }
    : null;
  const data = {
    semana: `${weekStartDate} – ${end}`,
    objetivo: target ? { kcal: target.kcal, protein: target.protein, carbs: target.carbs, fat: target.fat, fiber: target.fiber } : null,
    dias: days.map((d) => ({ date: d.date, estado: DAY_STATUS_LABEL[status.get(d.date)!], kcal: round(d.kcal, 0), protein: round(d.protein), carbs: round(d.carbs), fat: round(d.fat), fiber: round(d.fiber), entries: d.entries, upfKcalPct: d.upfKcalPct, quality: d.qualityScore })),
    carencias: gaps,
    cuerpo: body,
    salud: health,
    ...extras,
  };
  const { data: report } = await call(c, "weekly_report", PROMPTS.weekly, [{ type: "text", text: `${contextBlock(pc.lines)}\n\nDatos (JSON):\n${JSON.stringify(data)}` }], S.WeeklyReport, "medium");
  return { ...report, data };
}

/* ------------------------------ insights text ---------------------------- */

export async function explainCorrelation(c: FeatureCtx, corr: { exposure: string; symptom: string; ratio: number; exposures: number; withSymptom: number; windowHours: [number, number] }) {
  const text = `Exposición: ${corr.exposure}. Síntoma: ${corr.symptom}. Ventana ${corr.windowHours[0]}–${corr.windowHours[1]} h. Veces que se tomó: ${corr.exposures}; con síntoma después: ${corr.withSymptom}. Riesgo relativo aproximado: ${round(corr.ratio, 2)}.`;
  const { data } = await call(c, "correlation_explain", PROMPTS.correlation, [{ type: "text", text }], S.CorrelationExplanation, "low");
  return `${data.bodyMd}\n\n_${HEALTH_DISCLAIMER}_`;
}

/* ---------------------------------- coach -------------------------------- */

export interface CoachResult {
  conversationId: string;
  messageId: string;
  text: string;
  proposals: Proposal[];
  toolCalls: { name: string; ok: boolean }[];
}

/**
 * Coach turn with streaming. Persists the conversation; proposals are returned and stored in the
 * assistant message parts so the UI can render "Confirmar" buttons.
 */
export async function coachChat(
  c: PersonFeatureCtx & { groupId: string | null; timezone: string },
  input: { conversationId?: string; message: string; images?: Images; kind?: "coach" | "planner" | "retro"; onText?: (d: string) => void; onToolCall?: (name: string) => void },
): Promise<CoachResult> {
  const provider = c.provider ?? getProvider();
  await assertQuota(c.db, c.userId, provider.backend);
  if (!c.scopes.has("ai") && !c.scopes.has("diary")) throw new AiError("No tienes permiso para usar el coach con esta persona", "auth");

  let conversationId = input.conversationId;
  if (conversationId) {
    const [conv] = await c.db.select({ id: aiConversations.id }).from(aiConversations).where(and(eq(aiConversations.id, conversationId), eq(aiConversations.personId, c.personId), eq(aiConversations.userId, c.userId))).limit(1);
    if (!conv) throw new AiError("Conversación no encontrada", "unknown");
  } else {
    const [conv] = await c.db.insert(aiConversations).values({ personId: c.personId, userId: c.userId, kind: input.kind ?? "coach", title: input.message.slice(0, 60) }).returning({ id: aiConversations.id });
    conversationId = conv!.id;
  }
  const prev = await c.db.select({ role: aiMessages.role, content: aiMessages.content }).from(aiMessages).where(eq(aiMessages.conversationId, conversationId)).orderBy(desc(aiMessages.createdAt)).limit(20);
  await c.db.insert(aiMessages).values({ conversationId, role: "user", content: input.message, parts: input.images?.length ? [{ type: "images", count: input.images.length }] : [] });

  const pc = await buildPersonContext(c.db, c.personId, c.scopes);
  const ctx: ToolContext = { db: c.db, userId: c.userId, personId: c.personId, groupId: pc.groupId, timezone: pc.timezone, scopes: c.scopes, proposals: [] };
  const tools = toolsFor(c.scopes);
  let result;
  try {
    result = await provider.run({
      feature: "coach",
      system: PROMPTS.coach,
      history: prev.reverse().filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      message: [...(input.images ?? []), { type: "text", text: `${contextBlock(pc.lines)}\n\n${input.message}` }],
      tools,
      ctx,
      effort: "medium",
      maxTurns: 10,
      signal: c.signal,
      onText: input.onText,
      onToolCall: (name) => input.onToolCall?.(name),
    });
  } catch (e) {
    await recordUsage(c.db, { userId: c.userId, feature: "coach", backend: provider.backend, ok: e instanceof AiError ? e.code : "error" });
    throw e;
  }
  await recordUsage(c.db, { userId: c.userId, feature: "coach", backend: provider.backend, usage: result.usage });
  const [msg] = await c.db
    .insert(aiMessages)
    .values({ conversationId, role: "assistant", content: result.text, parts: [...result.toolCalls.map((t) => ({ type: "tool", name: t.name, ok: t.ok })), ...ctx.proposals.map((p) => ({ type: "proposal", ...p, status: "pending" }))] })
    .returning({ id: aiMessages.id });
  await c.db.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, conversationId));
  return { conversationId, messageId: msg!.id, text: result.text, proposals: ctx.proposals, toolCalls: result.toolCalls.map(({ name, ok }) => ({ name, ok })) };
}

/** After a conversation, propose durable memories (shown to the user to accept). */
export async function extractMemories(c: PersonFeatureCtx, conversationId: string) {
  const msgs = await c.db.select({ role: aiMessages.role, content: aiMessages.content }).from(aiMessages).where(eq(aiMessages.conversationId, conversationId)).orderBy(asc(aiMessages.createdAt)).limit(40);
  if (msgs.length < 2) return [];
  const text = msgs.map((m) => `${m.role === "user" ? "Usuario" : "Coach"}: ${m.content}`).join("\n");
  const { data } = await call(c, "memory_extract", PROMPTS.memory, [{ type: "text", text }], S.MemoryExtract, "low");
  return data.memories;
}

/** Learn portion sizes from user corrections of AI estimates (running mean). */
export async function learnPortion(db: Database, personId: string, phrase: string, grams: number, foodId?: string | null) {
  const key = portionKey(phrase);
  if (!key || grams <= 0) return;
  await db
    .insert(portionMemory)
    .values({ personId, key, grams, foodId: foodId ?? null })
    .onConflictDoUpdate({
      target: [portionMemory.personId, portionMemory.key],
      set: { grams: sql`(${portionMemory.grams} * ${portionMemory.samples} + ${grams}) / (${portionMemory.samples} + 1)`, samples: sql`${portionMemory.samples} + 1`, updatedAt: new Date() },
    });
}

