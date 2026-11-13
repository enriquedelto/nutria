/**
 * Sport profile for strength / hypertrophy training: protein per kg, fat floor, gain-rate presets,
 * training vs. rest day split, hydration and an evidence-graded supplement catalogue.
 *
 * References: Morton et al. 2018 (protein 1.6–2.2 g/kg), ISSN position stands (protein 2017,
 * creatine 2017, caffeine 2021), Iraki/Helms et al. 2019 (bulking 0.25–0.5 % BW/week).
 * Informative only.
 */
import { KCAL_PER_KG } from "./targets";
import type { DayTargets } from "./conditions";
import type { NutrientMap } from "./totals";

export type SportFocus = "hypertrophy" | "strength" | "general";
export type SportLevel = "recreational" | "competitive";

export interface SportProfile {
  focus: SportFocus;
  level: SportLevel;
  /** g/kg/day; default by level. Clamped to 1.6–2.2. */
  proteinPerKg?: number;
  /** ISO weekdays (1 = Monday) with planned training. */
  trainingDays?: number[];
  /** "opengym" when the days were filled from the openGym weekly plan (re-synced), "manual" otherwise. */
  trainingDaysSource?: "manual" | "opengym";
  /** More carbs on training days, fewer on rest days (same weekly average). */
  cycleCarbs?: boolean;
  /** Water goal from body weight + training time instead of the fixed setting. */
  waterAuto?: boolean;
  /** Gym opening hours ("HH:MM"), same every day: used to suggest the best time to train. */
  gymHours?: { from: string; to: string }[];
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Valid, ordered, non-empty ranges (at most 4). */
export function parseGymHours(v: unknown): { from: string; to: string }[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((w): w is { from: string; to: string } => !!w && HHMM.test(String(w.from)) && HHMM.test(String(w.to)) && String(w.from) < String(w.to))
    .map((w) => ({ from: w.from, to: w.to }))
    .sort((a, b) => a.from.localeCompare(b.from))
    .slice(0, 4);
  return out.length ? out : undefined;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Parse the athlete condition config with defaults (tolerates the legacy `{ proteinPerKg }`). */
export function sportProfile(config: Record<string, unknown> | null | undefined): SportProfile {
  const c = config ?? {};
  const days = Array.isArray(c.trainingDays) ? [...new Set(c.trainingDays.map(Number).filter((d) => d >= 1 && d <= 7))].sort((a, b) => a - b) : undefined;
  return {
    focus: c.focus === "strength" || c.focus === "general" ? c.focus : "hypertrophy",
    level: c.level === "competitive" ? "competitive" : "recreational",
    proteinPerKg: c.proteinPerKg != null && Number.isFinite(Number(c.proteinPerKg)) ? Number(c.proteinPerKg) : undefined,
    trainingDays: days,
    trainingDaysSource: c.trainingDaysSource === "opengym" ? "opengym" : days?.length ? "manual" : undefined,
    cycleCarbs: c.cycleCarbs === true,
    waterAuto: c.waterAuto === true,
    gymHours: parseGymHours(c.gymHours),
  };
}

export function sportProteinPerKg(sp: SportProfile): number {
  return clamp(sp.proteinPerKg ?? (sp.level === "competitive" ? 2.0 : 1.8), 1.6, 2.2);
}

/** Minimum fat: 0.8 g/kg and at least 25 % of kcal (hormonal health, fat-soluble vitamins). */
export function sportFatFloor(kcal: number, weightKg: number) {
  return Math.round(Math.max(0.8 * weightKg, (kcal * 0.25) / 9));
}

/** Protein by g/kg, fat ≥ floor (keeps a higher fat target), carbs = remainder. */
export function sportMacros(t: DayTargets, weightKg: number, sp: SportProfile): DayTargets {
  const protein = Math.round(sportProteinPerKg(sp) * weightKg);
  const fat = Math.max(Math.round(t.fat), sportFatFloor(t.kcal, weightKg));
  const carbs = Math.max(0, Math.round((t.kcal - protein * 4 - fat * 9) / 4));
  return { ...t, protein, fat, carbs };
}

export interface GainRatePreset {
  key: "lean" | "bulk";
  label: string;
  pctPerWeek: number;
  kgPerWeek: number;
  surplusKcal: number;
}

/** Surplus kcal/day for a weekly gain rate (kg). */
export const surplusForRate = (kgPerWeek: number) => Math.round((kgPerWeek * KCAL_PER_KG) / 7);

/** Bulking presets as % of body weight per week, rounded to 0.01 kg. */
export function gainRatePresets(weightKg: number): GainRatePreset[] {
  return (
    [
      ["lean", "Volumen limpio", 0.25],
      ["bulk", "Volumen", 0.5],
    ] as const
  ).map(([key, label, pct]) => {
    const kg = Math.round(weightKg * pct) / 100;
    return { key, label, pctPerWeek: pct, kgPerWeek: kg, surplusKcal: surplusForRate(kg) };
  });
}

/** Weekly gain as % of body weight. */
export const ratePctOfWeight = (kgPerWeek: number, weightKg: number) => (weightKg > 0 ? (kgPerWeek / weightKg) * 100 : 0);

type Macros = { kcal: number; protein: number; carbs: number; fat: number };

/**
 * Training/rest split with the same weekly average: training days get +share·rest/7 of the daily
 * kcal and rest days −share·training/7, all of it as carbs (protein and fat stay the same).
 * Returns null when every day (or no day) is a training day.
 */
export function trainingDaySplit<T extends Macros>(base: T, trainingDaysPerWeek: number, share = 0.1): { training: T; rest: T } | null {
  const t = Math.round(trainingDaysPerWeek);
  if (t <= 0 || t >= 7) return null;
  const r = 7 - t;
  // Rest days lose share·t/7 (never more than their carbs); training days gain the same in total.
  const down = Math.min(Math.round((base.kcal * share * t) / 7), Math.round(base.carbs * 4));
  const up = Math.round((down * r) / t);
  return {
    training: { ...base, kcal: base.kcal + up, carbs: Math.round(base.carbs + up / 4) },
    rest: { ...base, kcal: base.kcal - down, carbs: Math.round(base.carbs - down / 4) },
  };
}

/**
 * Daily water (all drinks, ≈ 80 % of total water; food adds the rest): 35 ml/kg plus ~0.6 L per
 * hour of training, rounded to 250 ml.
 */
export function waterTargetMl({ weightKg, trainingMin = 0 }: { weightKg: number; trainingMin?: number }) {
  const ml = 35 * weightKg + 10 * Math.max(0, trainingMin);
  return Math.round(ml / 250) * 250;
}

/* ------------------------------- supplements ------------------------------- */

export type Evidence = "A" | "B" | "C";

export interface SupplementDose {
  amount: number;
  unit: "g" | "mg" | "µg" | "cápsula";
  /** Grams logged in the diary per dose. */
  grams: number;
  label: string;
}

export interface SupplementInfo {
  code: string;
  name: string;
  evidence: Evidence;
  /** What it does, in one sentence. */
  purpose: string;
  /** When / how to take it. */
  timing: string;
  defaultTime: string;
  /** Daily schedule: every day or only training days. */
  days: "all" | "training";
  /** Shown for these goals ("any" = always). */
  goals: ("gain" | "any")[];
  dose(weightKg: number): SupplementDose;
  /** Nutrients per 100 g of product, used for the diary entry. */
  per100: NutrientMap;
  /** Extra notes depending on the active conditions / pregnancy / low labs. */
  cautions(ctx: { conditions: string[]; pregnant: boolean; lowLabs: string[] }): string[];
}

const round = (v: number, step: number) => Math.round(v / step) * step;

export const SUPPLEMENTS: SupplementInfo[] = [
  {
    code: "creatine",
    name: "Creatina monohidrato",
    evidence: "A",
    purpose: "Más fuerza y algo más de masa muscular con el entreno; el suplemento con más evidencia.",
    timing: "Cada día, también los de descanso, a cualquier hora (con una comida va bien). No hace falta fase de carga.",
    defaultTime: "09:00",
    days: "all",
    goals: ["gain", "any"],
    dose: (kg) => {
      const g = clamp(round(0.05 * kg, 0.5), 3, 5);
      return { amount: g, unit: "g", grams: g, label: `${g.toLocaleString("es-ES")} g` };
    },
    per100: {},
    cautions: ({ conditions }) => [
      ...(conditions.includes("ckd") ? ["Tienes enfermedad renal activada: consúltalo con tu médico antes de tomarla."] : []),
      "Puede subir 1–2 kg de peso al principio (agua dentro del músculo); no es grasa.",
      "Eleva un poco la creatinina en analíticas sin dañar el riñón: avisa si te hacen una.",
    ],
  },
  {
    code: "whey",
    name: "Proteína whey",
    evidence: "B",
    purpose: "Es comida, no magia: útil solo para llegar a tu proteína diaria cuando con comida cuesta.",
    timing: "Cuando te falte proteína, por ejemplo tras entrenar o en el desayuno.",
    defaultTime: "18:00",
    days: "training",
    goals: ["gain", "any"],
    dose: () => ({ amount: 30, unit: "g", grams: 30, label: "30 g (1 cacito)" }),
    per100: { energy_kcal: 380, protein: 78, carbs: 7, sugars: 5, fat: 5.5, sat_fat: 3.5, calcium: 450, sodium: 200 },
    cautions: () => ["Si tienes intolerancia a la lactosa, busca whey aislada o proteína vegetal."],
  },
  {
    code: "caffeine",
    name: "Cafeína",
    evidence: "A",
    purpose: "Mejora el rendimiento y retrasa la fatiga si la tomas antes de entrenar.",
    timing: "30–60 min antes de entrenar. Nunca en las 6 h antes de dormir: empeora el sueño, que importa más para ganar músculo.",
    defaultTime: "17:00",
    days: "training",
    goals: ["gain", "any"],
    dose: (kg) => {
      const mg = Math.min(400, round(3 * kg, 10));
      return { amount: mg, unit: "mg", grams: mg / 1000, label: `${mg} mg (≈ ${Math.max(1, Math.round(mg / 80))} café${Math.round(mg / 80) === 1 ? "" : "s"})` };
    },
    per100: { caffeine: 100_000 },
    cautions: ({ conditions, pregnant }) => [
      ...(pregnant ? ["Embarazo o lactancia: máximo 200 mg al día en total."] : []),
      ...(conditions.includes("hypertension") ? ["Con hipertensión, mejor consultarlo: la cafeína sube la tensión de forma pasajera."] : []),
      "No pases de 400 mg al día sumando café, té y bebidas energéticas. Empieza por 3 mg/kg; más de 6 mg/kg no aporta.",
    ],
  },
  {
    code: "vit_d",
    name: "Vitamina D3",
    evidence: "B",
    purpose: "Solo si una analítica la da baja o apenas te da el sol; si está normal no mejora el rendimiento.",
    timing: "Con la comida principal (es liposoluble).",
    defaultTime: "14:00",
    days: "all",
    goals: ["any"],
    dose: () => ({ amount: 20, unit: "µg", grams: 0.25, label: "20 µg (800 UI), 1 cápsula" }),
    per100: { vit_d: 8000 },
    cautions: ({ lowLabs }) => (lowLabs.includes("vit_d_25oh") ? ["Tu última analítica la tenía baja: sigue la dosis que te indique tu médico."] : ["Mejor pedir una analítica antes: con niveles normales no hace falta."]),
  },
  {
    code: "omega3",
    name: "Omega-3 (EPA + DHA)",
    evidence: "C",
    purpose: "Salud cardiovascular si comes poco pescado azul; el efecto sobre el músculo es pequeño.",
    timing: "Con una comida.",
    defaultTime: "14:00",
    days: "all",
    goals: ["any"],
    dose: () => ({ amount: 1, unit: "cápsula", grams: 1, label: "1 cápsula de 1 g (≈ 0,5 g de EPA + DHA)" }),
    per100: { energy_kcal: 900, fat: 100, omega3: 60, epa_dha: 50 },
    cautions: () => ["Mejor 2 raciones de pescado azul a la semana si te gusta."],
  },
];

export const SUPPLEMENT_BY_CODE = Object.fromEntries(SUPPLEMENTS.map((s) => [s.code, s])) as Record<string, SupplementInfo>;

/** Popular products that do not help (or have no evidence) for muscle gain. */
export const NOT_NEEDED: { name: string; why: string }[] = [
  { name: "BCAA / aminoácidos ramificados", why: "Si llegas a tu proteína diaria no añaden nada: la proteína completa ya los trae." },
  { name: "Glutamina", why: "No mejora la fuerza ni la masa muscular en personas sanas." },
  { name: "«Potenciadores de testosterona» (tribulus, ZMA, etc.)", why: "No suben la testosterona de forma relevante ni ayudan a ganar músculo." },
  { name: "Ganadores de peso (gainers)", why: "Son azúcar y proteína caros; si te cuesta comer, mejor batidos caseros (leche, avena, plátano, crema de cacahuete)." },
  { name: "Quemadores de grasa", why: "No sirven para ganar músculo y muchos llevan estimulantes en dosis altas." },
];

/** Protein per meal to spread the day's protein (≈ 0.4 g/kg, 4 meals). */
export const proteinPerMeal = (weightKg: number) => Math.round(0.4 * weightKg);
