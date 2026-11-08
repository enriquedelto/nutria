import { round } from "./nutrients";

export type NutrientMap = Record<string, number>;

export interface Per100 {
  nutrients: NutrientMap; // per 100 g
  density?: number; // g/ml
}

/** Merge locked (user-corrected) per-100 g values over the food values. */
export function applyLocked(per100: NutrientMap, locked: NutrientMap = {}): NutrientMap {
  return { ...per100, ...locked };
}

/** Scale per-100 g nutrients to an eaten amount in grams. */
export function scaleNutrients(per100: NutrientMap, grams: number, locked?: NutrientMap): NutrientMap {
  const base = applyLocked(per100, locked);
  const f = grams / 100;
  const out: NutrientMap = {};
  for (const [k, v] of Object.entries(base)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v * f;
  }
  return out;
}

/** Inverse: derive per-100 g locked value from an absolute value the user typed for this portion. */
export function lockFromAbsolute(absolute: number, grams: number): number {
  if (grams <= 0) return 0;
  return (absolute / grams) * 100;
}

export function sumNutrients(maps: NutrientMap[]): NutrientMap {
  const out: NutrientMap = {};
  for (const m of maps) for (const [k, v] of Object.entries(m)) out[k] = (out[k] ?? 0) + v;
  return out;
}

export function roundMap(m: NutrientMap, decimals = 2): NutrientMap {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round(v, decimals)]));
}

/** Macro columns extracted from a NutrientMap (for indexed columns / snapshots). */
export function macroColumns(m: NutrientMap) {
  return {
    kcal: m.energy_kcal ?? 0,
    protein: m.protein ?? 0,
    carbs: m.carbs ?? 0,
    fat: m.fat ?? 0,
    fiber: m.fiber ?? 0,
  };
}

/** Fill derived values: kcal from macros when missing, sodium<->salt, EPA+DHA. */
export function completeDerived(m: NutrientMap): NutrientMap {
  const out = { ...m };
  if (out.energy_kcal == null && (out.protein != null || out.carbs != null || out.fat != null)) {
    out.energy_kcal = 4 * (out.protein ?? 0) + 4 * (out.carbs ?? 0) + 9 * (out.fat ?? 0) + 2 * (out.fiber ?? 0) + 7 * (out.alcohol ?? 0);
  }
  if (out.sodium == null && out.salt != null) out.sodium = (out.salt / 2.5) * 1000;
  if (out.salt == null && out.sodium != null) out.salt = (out.sodium * 2.5) / 1000;
  if (out.epa_dha == null && (out.epa != null || out.dha != null)) out.epa_dha = (out.epa ?? 0) + (out.dha ?? 0);
  return out;
}

/** Household unit → grams resolution. */
export interface Serving {
  label: string;
  grams: number;
}

export function resolveGrams(input: { grams?: number; ml?: number; servingQty?: number; serving?: Serving }, density = 1): number {
  if (input.grams != null) return input.grams;
  if (input.ml != null) return input.ml * density;
  if (input.serving) return (input.servingQty ?? 1) * input.serving.grams;
  throw new Error("No hay cantidad");
}

/** Energy share of macros (% of kcal). */
export function macroSplit(m: NutrientMap): { protein: number; carbs: number; fat: number } {
  const p = (m.protein ?? 0) * 4;
  const c = (m.carbs ?? 0) * 4;
  const f = (m.fat ?? 0) * 9;
  const t = p + c + f;
  if (t === 0) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: p / t, carbs: c / t, fat: f / t };
}
