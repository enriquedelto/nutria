/**
 * Energy and macro/micro targets.
 * BMR: Mifflin-St Jeor (adults), Katch-McArdle when body fat is known, Schofield (children 3-17).
 */
import { DRV, drvFor, PER_MJ, type LifeStage, type Sex } from "./drv";
import { NUTRIENT_BY_CODE } from "./nutrients";

export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type GoalType = "lose" | "maintain" | "gain";
export type Pregnancy = "trimester1" | "trimester2" | "trimester3" | "lactation" | null;

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const KCAL_PER_KG = 7700;

export interface PersonProfile {
  sex: Sex;
  age: number;
  weightKg: number;
  heightCm: number;
  bodyFatPct?: number | null;
  activityLevel: ActivityLevel;
  goalType: GoalType;
  weeklyRateKg?: number; // negative to lose
  pregnancy?: Pregnancy;
}

export function ageFromBirthDate(birthDate: string, on: Date = new Date()): number {
  const b = new Date(`${birthDate}T00:00:00`);
  let age = on.getFullYear() - b.getFullYear();
  const m = on.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < b.getDate())) age--;
  return age;
}

export function bmr(p: Pick<PersonProfile, "sex" | "age" | "weightKg" | "heightCm" | "bodyFatPct">): number {
  if (p.age < 18) {
    // Schofield (weight only)
    const w = p.weightKg;
    if (p.sex === "male") return p.age < 10 ? 22.7 * w + 495 : 17.5 * w + 651;
    return p.age < 10 ? 22.5 * w + 499 : 12.2 * w + 746;
  }
  if (p.bodyFatPct != null && p.bodyFatPct > 3 && p.bodyFatPct < 60) {
    const lbm = p.weightKg * (1 - p.bodyFatPct / 100);
    return 370 + 21.6 * lbm;
  }
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return p.sex === "male" ? base + 5 : base - 161;
}

export function tdee(p: PersonProfile): number {
  return bmr(p) * ACTIVITY_FACTORS[p.activityLevel];
}

/** EFSA additional energy requirements in pregnancy / lactation (kcal/day). */
export function pregnancyExtraKcal(pg: Pregnancy | undefined): number {
  switch (pg) {
    case "trimester1":
      return 70;
    case "trimester2":
      return 260;
    case "trimester3":
      return 500;
    case "lactation":
      return 500;
    default:
      return 0;
  }
}

export function lifeStage(pg: Pregnancy | undefined): LifeStage {
  if (!pg) return null;
  return pg === "lactation" ? "lactation" : "pregnancy";
}

export interface MacroTargets {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  tdee: number;
  bmr: number;
  floorApplied: boolean;
}

/** Protein g/kg by activity and goal (0.83 EFSA PRI up to 2.2 for athletes cutting). */
export function proteinPerKg(activity: ActivityLevel, goal: GoalType): number {
  const base: Record<ActivityLevel, number> = { sedentary: 0.9, light: 1.0, moderate: 1.2, active: 1.6, very_active: 1.8 };
  let v = base[activity];
  if (goal === "lose") v += 0.4;
  if (goal === "gain") v = Math.max(v, 1.6);
  return Math.min(v, 2.2);
}

export function computeMacroTargets(p: PersonProfile, overrideTdee?: number): MacroTargets {
  const b = bmr(p);
  const t = overrideTdee ?? tdee(p);
  const pregnant = !!p.pregnancy;
  // weekly_rate_kg defaults to 0 in the DB: 0 with a lose/gain goal means "not set", not "no change".
  const defaultRate = p.goalType === "lose" ? -0.5 : p.goalType === "gain" ? 0.25 : 0;
  const rate = pregnant || p.age < 18 || p.goalType === "maintain" ? 0 : p.weeklyRateKg ? p.weeklyRateKg : defaultRate;
  let kcal = t + (rate * KCAL_PER_KG) / 7 + pregnancyExtraKcal(p.pregnancy);
  const floor = p.sex === "male" ? 1500 : 1200;
  let floorApplied = false;
  if (p.age >= 18 && kcal < Math.max(floor, b)) {
    kcal = Math.max(floor, b);
    floorApplied = true;
  }
  let protein = proteinPerKg(p.activityLevel, p.goalType) * p.weightKg;
  if (p.pregnancy === "trimester2") protein += 9;
  if (p.pregnancy === "trimester3") protein += 28;
  if (p.pregnancy === "lactation") protein += 19;
  if (p.age < 18) protein = Math.max(0.9 * p.weightKg, protein * 0.8);
  const fat = (kcal * 0.3) / 9;
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  const fiberRef = drvFor("fiber", p.sex, p.age, lifeStage(p.pregnancy))?.amount ?? 25;
  return {
    kcal: Math.round(kcal),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    fiber: fiberRef,
    tdee: Math.round(t),
    bmr: Math.round(b),
    floorApplied,
  };
}

/** Rebalance non-pinned macros to a new kcal keeping pinned ones fixed. */
export function rebalanceMacros(
  current: { kcal: number; protein: number; carbs: number; fat: number },
  newKcal: number,
  pinned: string[] = [],
): { kcal: number; protein: number; carbs: number; fat: number } {
  const out = { ...current, kcal: Math.round(newKcal) };
  const fixedKcal = (pinned.includes("protein") ? current.protein * 4 : 0) + (pinned.includes("fat") ? current.fat * 9 : 0) + (pinned.includes("carbs") ? current.carbs * 4 : 0);
  const free = (["protein", "carbs", "fat"] as const).filter((m) => !pinned.includes(m));
  const freeKcalNow = free.reduce((s, m) => s + current[m] * (m === "fat" ? 9 : 4), 0);
  const freeKcalNew = Math.max(0, newKcal - fixedKcal);
  for (const m of free) {
    const share = freeKcalNow > 0 ? (current[m] * (m === "fat" ? 9 : 4)) / freeKcalNow : 1 / free.length;
    out[m] = Math.round((freeKcalNew * share) / (m === "fat" ? 9 : 4));
  }
  return out;
}

export interface MicroTarget {
  min?: number;
  max?: number;
}

/** Micro targets (min = PRI/AI) and limits (max = UL / public health cap). */
export function computeMicroTargets(p: Pick<PersonProfile, "sex" | "age" | "pregnancy">, kcal: number): Record<string, MicroTarget> {
  const ls = lifeStage(p.pregnancy);
  const out: Record<string, MicroTarget> = {};
  const codes = [...new Set(DRV.map((r) => r.code))];
  for (const code of codes) {
    const r = drvFor(code, p.sex, p.age, ls);
    if (!r) continue;
    if (r.kind === "MAX") out[code] = { ...out[code], max: r.amount };
    else out[code] = { ...out[code], min: r.amount };
  }
  const mj = kcal * 0.004184;
  out.vit_b1 = { min: Math.round(PER_MJ.vit_b1 * mj * 100) / 100 };
  out.vit_b3 = { min: Math.round(PER_MJ.vit_b3 * mj * 10) / 10 };
  // Upper limits for adults from catalogue
  if (p.age >= 18) {
    for (const [code, def] of Object.entries(NUTRIENT_BY_CODE)) {
      if (def.ul != null) out[code] = { ...out[code], max: def.ul };
    }
  }
  // Public-health caps tied to energy
  out.sat_fat = { max: Math.round((kcal * 0.1) / 9) };
  out.added_sugars = { max: Math.round((kcal * 0.1) / 4) };
  return out;
}
