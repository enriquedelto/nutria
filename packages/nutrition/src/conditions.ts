/**
 * M9 condition modules. Each module can adjust targets, raise alerts for a food/entry and day,
 * and add context lines for the AI. Informative only — never a substitute for medical advice.
 */
import type { MicroTarget } from "./targets";
import type { NutrientMap } from "./totals";
import { proteinPerMeal, sportMacros, sportProfile, sportProteinPerKg } from "./sport";

export interface DayTargets {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  micros: Record<string, MicroTarget>;
}

export interface ConditionFood {
  name: string;
  nutrients: NutrientMap; // for the eaten amount
  categories?: string[];
  labels?: string[];
  allergens?: string[];
  ingredientsText?: string | null;
  mealSlot?: string;
}

export interface ConditionAlert {
  condition: string;
  level: "info" | "caution" | "avoid";
  message: string;
}

export interface ConditionContext {
  weightKg: number;
  config: Record<string, unknown>;
}

export interface ConditionModule {
  code: string;
  nameEs: string;
  adjustTargets?(t: DayTargets, ctx: ConditionContext): DayTargets;
  foodAlerts?(food: ConditionFood, ctx: ConditionContext): ConditionAlert[];
  dayAlerts?(totals: NutrientMap, t: DayTargets, ctx: ConditionContext): ConditionAlert[];
  aiContext(ctx: ConditionContext): string;
}

const kw = (food: ConditionFood, words: RegExp) => words.test(`${food.name} ${food.ingredientsText ?? ""}`.toLowerCase());
const hasCat = (food: ConditionFood, tags: string[]) => (food.categories ?? []).some((c) => tags.includes(c));
const n = (m: NutrientMap, k: string) => m[k] ?? 0;

/** Estimated glycemic load from carbs & fiber/sugar profile (rough; GI not in OFF). */
export function estimatedGlycemicLoad(m: NutrientMap): number {
  const avail = Math.max(0, n(m, "carbs") - n(m, "fiber"));
  const sugarShare = n(m, "carbs") > 0 ? n(m, "sugars") / n(m, "carbs") : 0;
  const fiberRatio = n(m, "carbs") > 0 ? n(m, "fiber") / n(m, "carbs") : 0;
  const gi = Math.max(25, Math.min(90, 70 - fiberRatio * 80 + (sugarShare - 0.3) * 20 - (n(m, "fat") + n(m, "protein") > 15 ? 10 : 0)));
  return Math.round((gi * avail) / 100);
}

const diabetes: ConditionModule = {
  code: "diabetes",
  nameEs: "Diabetes",
  adjustTargets(t, ctx) {
    const carbPct = Number(ctx.config.carbPct ?? 0.4);
    const carbs = Math.round((t.kcal * carbPct) / 4);
    const fat = Math.round((t.kcal - carbs * 4 - t.protein * 4) / 9);
    return { ...t, carbs, fat, fiber: Math.max(t.fiber ?? 25, 30), micros: { ...t.micros, added_sugars: { max: Math.round((t.kcal * 0.05) / 4) } } };
  },
  foodAlerts(food, ctx) {
    const out: ConditionAlert[] = [];
    const perMeal = Number(ctx.config.carbsPerMeal ?? 60);
    if (n(food.nutrients, "carbs") > perMeal)
      out.push({ condition: "diabetes", level: "caution", message: `Aporta ${Math.round(n(food.nutrients, "carbs"))} g de hidratos (${(n(food.nutrients, "carbs") / 10).toFixed(1)} raciones), más que tu objetivo por comida (${perMeal} g).` });
    const gl = estimatedGlycemicLoad(food.nutrients);
    if (gl >= 20) out.push({ condition: "diabetes", level: "caution", message: `Carga glucémica estimada alta (~${gl}). Combínalo con proteína, grasa o fibra.` });
    if (n(food.nutrients, "sugars") > 15) out.push({ condition: "diabetes", level: "info", message: "Alto en azúcares." });
    return out;
  },
  aiContext: (ctx) => `Diabetes: objetivo ~${ctx.config.carbsPerMeal ?? 60} g de hidratos por comida (1 ración = 10 g). Prioriza bajo índice glucémico, fibra y reparto regular de hidratos.`,
};

const hypertension: ConditionModule = {
  code: "hypertension",
  nameEs: "Hipertensión",
  adjustTargets(t, ctx) {
    const sodiumMax = Number(ctx.config.sodiumMaxMg ?? 1500);
    return { ...t, micros: { ...t.micros, sodium: { ...t.micros.sodium, max: sodiumMax }, salt: { max: (sodiumMax * 2.5) / 1000 }, potassium: { min: 3500 } } };
  },
  foodAlerts(food) {
    const s = n(food.nutrients, "sodium");
    return s > 600 ? [{ condition: "hypertension", level: "caution", message: `Mucho sodio (${Math.round(s)} mg en esta ración).` }] : [];
  },
  aiContext: (ctx) => `Hipertensión: sodio máx. ${ctx.config.sodiumMaxMg ?? 1500} mg/día, potasio alto (patrón DASH).`,
};

const PREGNANCY_AVOID = /(\bh[íi]gado\b|pat[ée]|crudo|tartar|carpaccio|sushi|ahumado|queso (fresco|azul) sin pasteurizar|leche cruda|pez espada|emperador|tibur[óo]n|at[úu]n rojo|lucio)/;
const pregnancy: ConditionModule = {
  code: "pregnancy",
  nameEs: "Embarazo / lactancia",
  foodAlerts(food) {
    const out: ConditionAlert[] = [];
    if (kw(food, PREGNANCY_AVOID)) out.push({ condition: "pregnancy", level: "avoid", message: "Alimento a evitar o tomar solo bien cocinado durante el embarazo (listeria, toxoplasma, mercurio o exceso de vitamina A)." });
    if (n(food.nutrients, "alcohol") > 0) out.push({ condition: "pregnancy", level: "avoid", message: "Contiene alcohol: evitar en embarazo y lactancia." });
    if (n(food.nutrients, "caffeine") > 100) out.push({ condition: "pregnancy", level: "caution", message: "Cafeína alta: máx. 200 mg/día." });
    return out;
  },
  aiContext: () => "Embarazo/lactancia: folato, yodo, hierro, DHA y calcio; evitar alcohol, crudos, pescados con mercurio alto; cafeína ≤200 mg.",
};

const vegan: ConditionModule = {
  code: "vegan",
  nameEs: "Vegano / vegetariano",
  dayAlerts(totals, t) {
    const out: ConditionAlert[] = [];
    if (n(totals, "vit_b12") < (t.micros.vit_b12?.min ?? 4) * 0.5) out.push({ condition: "vegan", level: "caution", message: "B12 baja: en dieta vegana es imprescindible suplementar B12." });
    return out;
  },
  foodAlerts(food, ctx) {
    if (ctx.config.strict === false) return [];
    const animal = (food.labels ?? []).includes("en:vegan") ? false : hasCat(food, ["en:meats", "en:fishes", "en:dairies", "en:eggs", "en:seafood"]);
    return animal ? [{ condition: "vegan", level: "info", message: "Este producto no parece vegano." }] : [];
  },
  aiContext: () => "Dieta vegana/vegetariana: vigilar B12 (suplemento), hierro (con vitamina C), zinc, yodo, calcio, omega-3 (ALA/algas) y proteína completa.",
};

const keto: ConditionModule = {
  code: "keto",
  nameEs: "Keto",
  adjustTargets(t, ctx) {
    const netCarbs = Number(ctx.config.netCarbsMax ?? 25);
    const carbs = netCarbs;
    const fat = Math.round((t.kcal - t.protein * 4 - carbs * 4) / 9);
    return { ...t, carbs, fat };
  },
  foodAlerts(food, ctx) {
    const net = n(food.nutrients, "carbs") - n(food.nutrients, "fiber");
    const max = Number(ctx.config.netCarbsMax ?? 25);
    return net > max * 0.4 ? [{ condition: "keto", level: "caution", message: `${Math.round(net)} g de hidratos netos: gran parte de tu límite diario (${max} g).` }] : [];
  },
  aiContext: (ctx) => `Keto: hidratos netos ≤ ${ctx.config.netCarbsMax ?? 25} g/día.`,
};

const FODMAP_HIGH = /(ajo|cebolla|puerro|trigo|centeno|manzana|pera|mango|sand[íi]a|miel|leche|yogur|garbanzo|lenteja|jud[íi]a|alubia|anacardo|pistacho|coliflor|champi[ñn][óo]n|esp[áa]rrago|alcachofa|sirope de agave|fructosa|sorbitol|manitol|inulina)/;
const fodmap: ConditionModule = {
  code: "fodmap",
  nameEs: "FODMAP",
  foodAlerts(food, ctx) {
    if (ctx.config.phase === "reintroduction") return [];
    return kw(food, FODMAP_HIGH) ? [{ condition: "fodmap", level: "caution", message: "Puede ser alto en FODMAP (fase de eliminación)." }] : [];
  },
  aiContext: (ctx) => `Dieta baja en FODMAP, fase: ${ctx.config.phase ?? "eliminación"}.`,
};

const celiac: ConditionModule = {
  code: "celiac",
  nameEs: "Celiaquía",
  foodAlerts(food) {
    if ((food.labels ?? []).includes("en:no-gluten") || (food.labels ?? []).includes("en:gluten-free")) return [];
    if ((food.allergens ?? []).includes("en:gluten") || kw(food, /(trigo|cebada|centeno|espelta|kamut|seit[áa]n|harina\b|pan\b|pasta\b|cuscús)/))
      return [{ condition: "celiac", level: "avoid", message: "Contiene o puede contener gluten." }];
    return [];
  },
  aiContext: () => "Celiaquía: dieta estricta sin gluten (ni trazas).",
};

const athlete: ConditionModule = {
  code: "athlete",
  nameEs: "Deportista",
  adjustTargets(t, ctx) {
    return sportMacros(t, ctx.weightKg, sportProfile(ctx.config));
  },
  dayAlerts(totals, t, ctx) {
    const sp = sportProfile(ctx.config);
    if (sp.focus === "general" || t.carbs >= 4 * ctx.weightKg) return [];
    return [{ condition: "athlete", level: "info", message: `Tu objetivo de hidratos (${Math.round(t.carbs)} g = ${(t.carbs / ctx.weightKg).toFixed(1)} g/kg) queda por debajo de 4 g/kg, lo mínimo recomendado para entrenar fuerza o hipertrofia.` }];
  },
  aiContext: (ctx) => {
    const sp = sportProfile(ctx.config);
    const DOW = ["", "L", "M", "X", "J", "V", "S", "D"];
    const focus = { hypertrophy: "hipertrofia", strength: "fuerza", general: "general" }[sp.focus];
    return [
      `Deportista (${focus}, nivel ${sp.level === "competitive" ? "competitivo" : "recreativo"}): proteína ${sportProteinPerKg(sp).toLocaleString("es-ES")} g/kg repartida en ~4 tomas de ~${proteinPerMeal(ctx.weightKg)} g; grasa ≥ 0,8 g/kg; hidratos 4–7 g/kg, sobre todo alrededor del entreno.`,
      sp.trainingDays?.length ? `Días de entreno previstos: ${sp.trainingDays.map((d) => DOW[d]).join(" ")}${sp.cycleCarbs ? " (más hidratos esos días, menos en descanso)" : ""}.` : "",
      "Suplementos: solo la creatina (3–5 g/día) tiene evidencia fuerte; cafeína opcional antes de entrenar; proteína en polvo solo si no llega con comida. BCAA, glutamina y «potenciadores» no aportan.",
    ].filter(Boolean).join(" ");
  },
};

const ckd: ConditionModule = {
  code: "ckd",
  nameEs: "Enfermedad renal",
  adjustTargets(t, ctx) {
    return {
      ...t,
      protein: Math.round(Number(ctx.config.proteinPerKg ?? 0.8) * ctx.weightKg),
      micros: { ...t.micros, potassium: { max: Number(ctx.config.potassiumMaxMg ?? 2500) }, phosphorus: { max: Number(ctx.config.phosphorusMaxMg ?? 1000) }, sodium: { max: 2000 } },
    };
  },
  aiContext: () => "Enfermedad renal: limitar potasio, fósforo, sodio y proteína según pauta médica.",
};

export const CONDITIONS: Record<string, ConditionModule> = Object.fromEntries(
  [diabetes, hypertension, pregnancy, vegan, keto, fodmap, celiac, athlete, ckd].map((m) => [m.code, m]),
);

export interface ActiveCondition {
  code: string;
  config?: Record<string, unknown>;
}

export function applyConditions(t: DayTargets, active: ActiveCondition[], weightKg: number): DayTargets {
  return active.reduce((acc, c) => CONDITIONS[c.code]?.adjustTargets?.(acc, { weightKg, config: c.config ?? {} }) ?? acc, t);
}

export function conditionFoodAlerts(food: ConditionFood, active: ActiveCondition[], weightKg: number): ConditionAlert[] {
  return active.flatMap((c) => CONDITIONS[c.code]?.foodAlerts?.(food, { weightKg, config: c.config ?? {} }) ?? []);
}

export function conditionDayAlerts(totals: NutrientMap, t: DayTargets, active: ActiveCondition[], weightKg: number): ConditionAlert[] {
  return active.flatMap((c) => CONDITIONS[c.code]?.dayAlerts?.(totals, t, { weightKg, config: c.config ?? {} }) ?? []);
}

export function conditionsAiContext(active: ActiveCondition[], weightKg: number): string[] {
  return active.map((c) => CONDITIONS[c.code]?.aiContext({ weightKg, config: c.config ?? {} })).filter((s): s is string => !!s);
}
