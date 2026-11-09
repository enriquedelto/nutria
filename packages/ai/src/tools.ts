/**
 * Tools the coach/planner can call. Read tools are scope-checked against person_access;
 * `propose_*` tools never write: they push a Proposal the UI shows for confirmation.
 */
import { z } from "zod";
import {
  and,
  asc,
  between,
  cyclePeriods,
  desc,
  diaryEntries,
  drugFoodInteractions,
  eq,
  exerciseLogs,
  foodServings,
  foods,
  gte,
  ilike,
  inArray,
  insights,
  isNotNull,
  labParameters,
  labResults,
  medications,
  or,
  pantryItems,
  persons,
  personConditions,
  recipes,
  searchFoods,
  sleepLogs,
  sql,
  stepLogs,
  symptomLogs,
  targetSets,
  tdeeEstimates,
  weightLogs,
} from "@nutria/db";
import {
  addDays,
  ageFromBirthDate,
  averageCycleLength,
  CYCLE_PHASE_NOTES,
  cyclePhase,
  forecastWeight,
  NUTRIENT_BY_CODE,
  round,
  sumNutrients,
  todayIn,
  trendWeights,
} from "@nutria/nutrition";
import type { AiTool, ToolContext } from "./types";

const define = <S extends z.ZodObject>(t: AiTool<S>) => t as unknown as AiTool;
const today = (ctx: ToolContext) => todayIn(ctx.timezone, ctx.now);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD");
const days = (max: number, def: number) => z.number().int().min(1).max(max).default(def);

function compactFood(f: typeof foods.$inferSelect) {
  return {
    id: f.id,
    name: f.nameEs ?? f.name,
    brand: f.brand,
    source: f.source,
    per100g: { kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, fiber: f.fiber, salt: f.salt },
    nutriscore: f.nutriscore,
    nova: f.nova,
    allergens: f.allergens,
  };
}

/* ---------------------------------- foods --------------------------------- */

const searchFoodsTool = define({
  name: "search_foods",
  description: "Busca alimentos en el catálogo local (Open Food Facts, CIQUAL y los del grupo). Devuelve valores por 100 g.",
  input: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(20).default(8) }),
  async run({ query, limit }, ctx) {
    const rows = await searchFoods(ctx.db, query, { groupId: ctx.groupId, limit });
    return rows.map(compactFood);
  },
});

const getFood = define({
  name: "get_food",
  description: "Ficha completa de un alimento: todos los nutrientes por 100 g, raciones caseras, aditivos e ingredientes.",
  input: z.object({ foodId: z.string().uuid() }),
  async run({ foodId }, ctx) {
    const [f] = await ctx.db.select().from(foods).where(eq(foods.id, foodId)).limit(1);
    if (!f) return "No existe ese alimento.";
    const servings = await ctx.db.select({ label: foodServings.label, grams: foodServings.grams }).from(foodServings).where(eq(foodServings.foodId, foodId));
    return {
      ...compactFood(f),
      nutrients: Object.fromEntries(Object.entries(f.nutrients).map(([k, v]) => [k, `${round(v, 2)} ${NUTRIENT_BY_CODE[k]?.unit ?? ""}`.trim()])),
      servings,
      additives: f.additives,
      ingredients: f.ingredientsText,
    };
  },
});

const nutrientRanking = define({
  name: "nutrient_ranking",
  description: "Oráculo de nutrientes: alimentos con más cantidad de un nutriente por 100 g o por 100 kcal (p. ej. hierro, proteína, fibra).",
  input: z.object({
    nutrient: z.string().describe("Código: iron, protein, fiber, calcium, vit_c, magnesium, potassium, folate, vit_b12, omega3…"),
    per: z.enum(["100g", "100kcal"]).default("100kcal"),
    genericOnly: z.boolean().default(true).describe("Solo alimentos genéricos (CIQUAL), sin marcas"),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  async run({ nutrient, per, genericOnly, limit }, ctx) {
    if (!NUTRIENT_BY_CODE[nutrient]) return `Nutriente desconocido: ${nutrient}`;
    const amount = sql<number>`(${foods.nutrients}->>${nutrient})::float`;
    const score = per === "100g" ? amount : sql<number>`${amount} * 100 / nullif(${foods.kcal}, 0)`;
    const rows = await ctx.db
      .select({ id: foods.id, name: sql<string>`coalesce(${foods.nameEs}, ${foods.name})`, brand: foods.brand, kcal: foods.kcal, amount, score })
      .from(foods)
      .where(and(sql`${foods.nutrients} ? ${nutrient}`, genericOnly ? eq(foods.source, "ciqual") : undefined, per === "100kcal" ? sql`${foods.kcal} > 20` : undefined))
      .orderBy(desc(score))
      .limit(limit);
    const unit = NUTRIENT_BY_CODE[nutrient]!.unit;
    return rows.map((r) => ({ ...r, amount: `${round(r.amount, 2)} ${unit}/100 g`, score: `${round(r.score, 2)} ${unit}/${per}` }));
  },
});

/* --------------------------------- diary ---------------------------------- */

const getDiary = define({
  name: "get_diary",
  description: "Diario de comidas entre dos fechas: entradas por comida y totales diarios de energía, macros y micros.",
  scope: "diary",
  input: z.object({ from: dateStr.optional(), to: dateStr.optional(), includeMicros: z.boolean().default(false) }),
  async run({ from, to, includeMicros }, ctx) {
    const end = to ?? today(ctx);
    const start = from ?? end;
    if (Date.parse(end) - Date.parse(start) > 31 * 86_400_000) return "Pide como máximo 31 días.";
    const rows = await ctx.db
      .select()
      .from(diaryEntries)
      .where(and(eq(diaryEntries.personId, ctx.personId), between(diaryEntries.date, start, end)))
      .orderBy(asc(diaryEntries.date), asc(diaryEntries.eatenAt));
    const byDay = new Map<string, typeof rows>();
    for (const r of rows) byDay.set(r.date, [...(byDay.get(r.date) ?? []), r]);
    return [...byDay].map(([date, entries]) => {
      const totals = sumNutrients(entries.map((e) => e.nutrients));
      return {
        date,
        totals: {
          kcal: round(entries.reduce((s, e) => s + e.kcal, 0), 0),
          protein: round(entries.reduce((s, e) => s + e.protein, 0)),
          carbs: round(entries.reduce((s, e) => s + e.carbs, 0)),
          fat: round(entries.reduce((s, e) => s + e.fat, 0)),
          fiber: round(entries.reduce((s, e) => s + e.fiber, 0)),
          ...(includeMicros ? { micros: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v, 2)])) } : {}),
        },
        entries: entries.map((e) => ({ mealSlot: e.mealSlot, name: e.name, grams: e.grams, kcal: round(e.kcal, 0), protein: round(e.protein), nova: e.nova })),
      };
    });
  },
});

const getTargets = define({
  name: "get_targets",
  description: "Objetivos diarios vigentes (kcal, macros, micros mínimos y límites) y macros fijados.",
  scope: "diary",
  input: z.object({}),
  async run(_i, ctx) {
    const sets = await ctx.db.select().from(targetSets).where(eq(targetSets.personId, ctx.personId)).orderBy(desc(targetSets.isDefault));
    return sets.map((t) => ({ name: t.name, isDefault: t.isDefault, kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, fiber: t.fiber, pinned: t.pinned, mode: t.mode, rule: t.rule, micros: t.micros }));
  },
});

/* -------------------------------- profile --------------------------------- */

const getProfile = define({
  name: "get_profile",
  description: "Perfil de la persona: edad, sexo, altura, actividad, objetivo, patrón de dieta, alérgenos, disgustos, preferencias y condiciones.",
  input: z.object({}),
  async run(_i, ctx) {
    const [p] = await ctx.db.select().from(persons).where(eq(persons.id, ctx.personId)).limit(1);
    if (!p) return "Persona no encontrada.";
    const conds = ctx.scopes.has("health")
      ? await ctx.db.select({ code: personConditions.conditionCode, config: personConditions.config }).from(personConditions).where(and(eq(personConditions.personId, p.id), eq(personConditions.active, true)))
      : [];
    return {
      name: p.displayName,
      age: p.birthDate ? ageFromBirthDate(p.birthDate) : null,
      sex: p.sex,
      heightCm: p.heightCm,
      activityLevel: p.activityLevel,
      goal: p.goalType,
      weeklyRateKg: p.weeklyRateKg,
      dietPattern: p.dietPattern,
      allergens: p.allergens,
      dislikes: p.dislikes,
      preferences: p.preferencesMd,
      isChild: p.isChild,
      pregnancy: ctx.scopes.has("health") ? p.pregnancy : undefined,
      conditions: conds,
    };
  },
});

/* ------------------------------ body/progress ----------------------------- */

const getWeight = define({
  name: "get_weight",
  description: "Pesajes recientes con la tendencia suavizada y la última estimación de TDEE adaptativo.",
  scope: "body",
  input: z.object({ days: days(365, 60) }),
  async run({ days: n }, ctx) {
    const from = addDays(today(ctx), -n);
    const ws = await ctx.db.select({ date: weightLogs.date, kg: weightLogs.kg, bodyFatPct: weightLogs.bodyFatPct }).from(weightLogs).where(and(eq(weightLogs.personId, ctx.personId), gte(weightLogs.date, from))).orderBy(asc(weightLogs.date));
    const trend = trendWeights(ws.map((w) => ({ date: w.date, weightKg: w.kg })));
    const [tdee] = await ctx.db.select().from(tdeeEstimates).where(eq(tdeeEstimates.personId, ctx.personId)).orderBy(desc(tdeeEstimates.date)).limit(1);
    return {
      weights: ws.map((w, i) => ({ ...w, trendKg: trend[i] != null ? round(trend[i]!, 2) : null })),
      tdee: tdee ? { date: tdee.date, formula: tdee.formulaTdee, adaptive: tdee.adaptiveTdee, avgIntake: tdee.avgIntake, confidence: tdee.confidence, underLoggingSuspected: tdee.underLoggingSuspected, suggestedKcal: tdee.suggestedKcal } : null,
    };
  },
});

const getForecast = define({
  name: "get_forecast",
  description: "Previsión de peso a 30/60/90 días según la ingesta media reciente y el TDEE estimado.",
  scope: "body",
  input: z.object({ plannedKcal: z.number().optional().describe("Ingesta diaria a simular; por defecto la media de los últimos 14 días") }),
  async run({ plannedKcal }, ctx) {
    const t = today(ctx);
    const [tdee] = await ctx.db.select().from(tdeeEstimates).where(eq(tdeeEstimates.personId, ctx.personId)).orderBy(desc(tdeeEstimates.date)).limit(1);
    const ws = await ctx.db.select({ date: weightLogs.date, kg: weightLogs.kg }).from(weightLogs).where(eq(weightLogs.personId, ctx.personId)).orderBy(desc(weightLogs.date)).limit(30);
    if (!ws.length) return "Sin pesajes: no se puede prever.";
    const trend = trendWeights([...ws].reverse().map((w) => ({ date: w.date, weightKg: w.kg })));
    const current = trend.at(-1) ?? ws[0]!.kg;
    const [avg] = await ctx.db
      .select({ kcal: sql<number>`coalesce(sum(${diaryEntries.kcal}) / nullif(count(distinct ${diaryEntries.date}), 0), 0)` })
      .from(diaryEntries)
      .where(and(eq(diaryEntries.personId, ctx.personId), gte(diaryEntries.date, addDays(t, -14))));
    const intake = plannedKcal ?? avg?.kcal ?? 0;
    const tdeeValue = tdee?.adaptiveTdee ?? tdee?.formulaTdee;
    if (!tdeeValue || !intake) return "Faltan datos de TDEE o de ingesta.";
    return { currentTrendKg: round(current, 1), intake: round(intake, 0), tdee: round(tdeeValue, 0), forecast: forecastWeight({ fromDate: t, currentTrendKg: current, plannedIntake: intake, tdee: tdeeValue }) };
  },
});

const getExercise = define({
  name: "get_exercise",
  description: "Ejercicio (manual u openGym) y pasos de los últimos días. Los entrenos de openGym traen los ejercicios con sus series (repeticiones×kg) y los récords del día.",
  scope: "body",
  input: z.object({ days: days(60, 14) }),
  async run({ days: n }, ctx) {
    const from = addDays(today(ctx), -n);
    const rows = await ctx.db.select({ date: exerciseLogs.date, name: exerciseLogs.name, durationMin: exerciseLogs.durationMin, kcal: exerciseLogs.kcal, volumeKg: exerciseLogs.volumeKg, source: exerciseLogs.source, details: exerciseLogs.details }).from(exerciseLogs).where(and(eq(exerciseLogs.personId, ctx.personId), gte(exerciseLogs.date, from))).orderBy(desc(exerciseLogs.date));
    type Ex = { name?: string; sets?: { kg: number | null; reps: number | null }[] };
    const exercise = rows.map(({ details, ...r }) => {
      const exs = Array.isArray(details.exercises) ? (details.exercises as Ex[]) : [];
      const prs = Array.isArray(details.prs) ? (details.prs as string[]) : [];
      return {
        ...r,
        ...(exs.length ? { exercises: exs.map((e) => ({ name: e.name, sets: (e.sets ?? []).map((s) => `${s.reps ?? "?"}${s.kg ? `×${s.kg}kg` : ""}`).join(", ") })) } : {}),
        ...(prs.length ? { prs } : {}),
      };
    });
    const steps = await ctx.db.select({ date: stepLogs.date, steps: stepLogs.steps }).from(stepLogs).where(and(eq(stepLogs.personId, ctx.personId), gte(stepLogs.date, from))).orderBy(desc(stepLogs.date));
    return { exercise, steps };
  },
});

/* ------------------------------ health (private) -------------------------- */

const getSleep = define({
  name: "get_sleep",
  description: "Sueño reciente: horas, calidad y hora de acostarse.",
  scope: "health",
  input: z.object({ days: days(60, 14) }),
  async run({ days: n }, ctx) {
    return ctx.db.select({ date: sleepLogs.date, hours: sleepLogs.hours, quality: sleepLogs.quality, bedtime: sleepLogs.bedtime }).from(sleepLogs).where(and(eq(sleepLogs.personId, ctx.personId), gte(sleepLogs.date, addDays(today(ctx), -n)))).orderBy(desc(sleepLogs.date));
  },
});

const getCycle = define({
  name: "get_cycle",
  description: "Fase estimada del ciclo menstrual y su implicación nutricional (peso por retención, apetito, hierro).",
  scope: "cycle",
  input: z.object({}),
  async run(_i, ctx) {
    const ps = await ctx.db.select({ startDate: cyclePeriods.startDate }).from(cyclePeriods).where(eq(cyclePeriods.personId, ctx.personId)).orderBy(desc(cyclePeriods.startDate)).limit(8);
    if (!ps.length) return "Sin registros de ciclo.";
    const len = averageCycleLength(ps.map((p) => p.startDate).reverse());
    const c = cyclePhase(ps[0]!.startDate, today(ctx), len);
    return { ...c, cycleLength: len, note: CYCLE_PHASE_NOTES[c.phase] };
  },
});

const getSymptoms = define({
  name: "get_symptoms",
  description: "Síntomas digestivos y generales registrados y correlaciones detectadas con alimentos.",
  scope: "health",
  input: z.object({ days: days(90, 30) }),
  async run({ days: n }, ctx) {
    const logs = await ctx.db.select({ date: symptomLogs.date, occurredAt: symptomLogs.occurredAt, symptom: symptomLogs.symptom, intensity: symptomLogs.intensity }).from(symptomLogs).where(and(eq(symptomLogs.personId, ctx.personId), gte(symptomLogs.date, addDays(today(ctx), -n)))).orderBy(desc(symptomLogs.occurredAt)).limit(200);
    const corr = await ctx.db.select({ title: insights.title, bodyMd: insights.bodyMd, score: insights.score, data: insights.data }).from(insights).where(and(eq(insights.personId, ctx.personId), eq(insights.kind, "symptom_correlation"))).orderBy(desc(insights.createdAt)).limit(10);
    return { logs, correlations: corr };
  },
});

const getLabs = define({
  name: "get_labs",
  description: "Últimos resultados de analíticas por parámetro, con rango de referencia y marca de fuera de rango.",
  scope: "labs",
  input: z.object({ parameter: z.string().optional().describe("Código de parámetro para ver su evolución") }),
  async run({ parameter }, ctx) {
    const rows = await ctx.db
      .select({ date: labResults.date, code: labResults.parameterCode, name: sql<string>`coalesce(${labParameters.nameEs}, ${labResults.rawName})`, value: labResults.value, unit: labResults.unit, refLow: labResults.refLow, refHigh: labResults.refHigh, flag: labResults.flag, relatedNutrient: labParameters.relatedNutrient })
      .from(labResults)
      .leftJoin(labParameters, eq(labParameters.code, labResults.parameterCode))
      .where(and(eq(labResults.personId, ctx.personId), parameter ? eq(labResults.parameterCode, parameter) : undefined))
      .orderBy(desc(labResults.date))
      .limit(parameter ? 50 : 300);
    if (parameter) return rows;
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.code ?? r.name)) latest.set(r.code ?? r.name, r);
    return [...latest.values()];
  },
});

const getMedications = define({
  name: "get_medications",
  description: "Medicación activa con horarios y las interacciones con alimentos de la tabla curada (no inventes otras).",
  scope: "medication",
  input: z.object({}),
  async run(_i, ctx) {
    const meds = await ctx.db.select({ name: medications.name, substanceCode: medications.substanceCode, dose: medications.dose, times: medications.times, withFood: medications.withFood }).from(medications).where(and(eq(medications.personId, ctx.personId), eq(medications.active, true)));
    const codes = meds.map((m) => m.substanceCode).filter((c): c is string => !!c);
    const inter = codes.length ? await ctx.db.select({ substance: drugFoodInteractions.substanceNameEs, matchType: drugFoodInteractions.matchType, matchValue: drugFoodInteractions.matchValue, severity: drugFoodInteractions.severity, message: drugFoodInteractions.messageEs }).from(drugFoodInteractions).where(inArray(drugFoodInteractions.substanceCode, codes)) : [];
    return { medications: meds, interactions: inter };
  },
});

/* --------------------------------- kitchen -------------------------------- */

const getPantry = define({
  name: "get_pantry",
  description: "Despensa del hogar (nevera, congelador, despensa) ordenada por caducidad.",
  input: z.object({ expiringWithinDays: z.number().int().optional() }),
  async run({ expiringWithinDays }, ctx) {
    if (!ctx.groupId) return [];
    const limit = expiringWithinDays != null ? addDays(today(ctx), expiringWithinDays) : null;
    return ctx.db
      .select({ name: pantryItems.name, quantity: pantryItems.quantity, unit: pantryItems.unit, location: pantryItems.location, expiresOn: pantryItems.expiresOn, foodId: pantryItems.foodId })
      .from(pantryItems)
      .where(and(eq(pantryItems.groupId, ctx.groupId), limit ? and(isNotNull(pantryItems.expiresOn), sql`${pantryItems.expiresOn} <= ${limit}`) : undefined))
      .orderBy(sql`${pantryItems.expiresOn} asc nulls last`)
      .limit(200);
  },
});

const getRecipes = define({
  name: "get_recipes",
  description: "Recetas guardadas del hogar (con nutrición por ración). Filtra por texto o etiqueta.",
  input: z.object({ query: z.string().optional(), limit: z.number().int().min(1).max(30).default(15) }),
  async run({ query, limit }, ctx) {
    if (!ctx.groupId) return [];
    return ctx.db
      .select({ id: recipes.id, title: recipes.title, servings: recipes.servings, prepMin: recipes.prepMin, cookMin: recipes.cookMin, tags: recipes.tags, kcal: recipes.kcalPerServing, protein: recipes.proteinPerServing, carbs: recipes.carbsPerServing, fat: recipes.fatPerServing, costPerServing: recipes.costPerServing })
      .from(recipes)
      .where(and(eq(recipes.groupId, ctx.groupId), query ? or(ilike(recipes.title, `%${query}%`), sql`${query} = any(${recipes.tags})`) : undefined))
      .orderBy(desc(recipes.updatedAt))
      .limit(limit);
  },
});

/* -------------------------------- proposals ------------------------------- */

const proposeDiary = define({
  name: "propose_diary_entries",
  description: "Propone añadir alimentos al diario. NO se guarda: el usuario lo confirma o edita en la app.",
  scope: "diary",
  input: z.object({
    date: dateStr.optional(),
    mealSlot: z.enum(["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "late_snack"]),
    items: z.array(z.object({ foodId: z.string().uuid().optional(), name: z.string(), grams: z.number().positive() })).min(1).max(20),
  }),
  async run(input, ctx) {
    const date = input.date ?? today(ctx);
    ctx.proposals.push({ kind: "diary_entries", summary: `${input.items.length} alimento(s) en ${input.mealSlot} del ${date}`, payload: { ...input, date } });
    return "Propuesta creada; el usuario debe confirmarla.";
  },
});

const proposeMemory = define({
  name: "propose_memory",
  description: "Propone recordar un dato duradero de la persona (gustos, rutina, objetivos, cocina…). El usuario lo confirma.",
  input: z.object({ category: z.enum(["gustos", "rutina", "salud", "objetivos", "cocina", "otros"]), contentMd: z.string().min(3).max(600) }),
  async run(input, ctx) {
    ctx.proposals.push({ kind: "memory", summary: `Recordar (${input.category}): ${input.contentMd.slice(0, 80)}`, payload: input });
    return "Propuesta de memoria creada.";
  },
});

const proposeTargets = define({
  name: "propose_target_change",
  description: "Propone cambiar los objetivos diarios. Explica el motivo. El usuario decide.",
  scope: "diary",
  input: z.object({ kcal: z.number().optional(), protein: z.number().optional(), carbs: z.number().optional(), fat: z.number().optional(), reason: z.string() }),
  async run(input, ctx) {
    ctx.proposals.push({ kind: "targets", summary: `Cambiar objetivos: ${input.reason}`, payload: input });
    return "Propuesta de objetivos creada.";
  },
});

const proposeShopping = define({
  name: "propose_shopping_items",
  description: "Propone añadir productos a la lista de la compra.",
  input: z.object({ items: z.array(z.object({ name: z.string(), quantity: z.number().optional(), unit: z.string().optional() })).min(1).max(50) }),
  async run(input, ctx) {
    ctx.proposals.push({ kind: "shopping", summary: `${input.items.length} producto(s) a la lista`, payload: input });
    return "Propuesta de compra creada.";
  },
});

const proposeReminder = define({
  name: "propose_reminder",
  description: "Propone un recordatorio (beber agua, registrar comida, pesarse, medicación…).",
  input: z.object({ title: z.string(), time: z.string().regex(/^\d{2}:\d{2}$/), daysOfWeek: z.array(z.number().int().min(1).max(7)).default([1, 2, 3, 4, 5, 6, 7]) }),
  async run(input, ctx) {
    ctx.proposals.push({ kind: "reminder", summary: `Recordatorio ${input.time}: ${input.title}`, payload: input });
    return "Propuesta de recordatorio creada.";
  },
});

export const READ_TOOLS: AiTool[] = [
  searchFoodsTool,
  getFood,
  nutrientRanking,
  getDiary,
  getTargets,
  getProfile,
  getWeight,
  getForecast,
  getExercise,
  getSleep,
  getCycle,
  getSymptoms,
  getLabs,
  getMedications,
  getPantry,
  getRecipes,
];
export const PROPOSE_TOOLS: AiTool[] = [proposeDiary, proposeMemory, proposeTargets, proposeShopping, proposeReminder];
export const ALL_TOOLS: AiTool[] = [...READ_TOOLS, ...PROPOSE_TOOLS];

/** Tools available given the caller's scopes (unavailable ones aren't even offered to the model). */
export function toolsFor(scopes: ReadonlySet<string>, opts: { propose?: boolean } = {}): AiTool[] {
  return (opts.propose === false ? READ_TOOLS : ALL_TOOLS).filter((t) => !t.scope || scopes.has(t.scope));
}
