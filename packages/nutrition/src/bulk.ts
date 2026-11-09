/**
 * Weekly bulk review: real weight trend vs. the chosen gain rate, a calorie proposal when it is
 * off for long enough, weekly hard sets per muscle and the «¿músculo o grasa?» signal
 * (weight, strength and waist together).
 */
import { KCAL_PER_KG } from "./targets";
import { addDays } from "./tdee-adaptive";
import { e1rm, workoutExercises, type TrainingLog } from "./training";

export const MUSCLE_GROUPS = [
  { key: "pecho", label: "Pecho" },
  { key: "espalda", label: "Espalda" },
  { key: "hombros", label: "Hombros" },
  { key: "biceps", label: "Bíceps" },
  { key: "triceps", label: "Tríceps" },
  { key: "cuadriceps", label: "Cuádriceps" },
  { key: "isquios", label: "Isquiotibiales" },
  { key: "gluteos", label: "Glúteos" },
  { key: "gemelos", label: "Gemelos" },
  { key: "antebrazo", label: "Antebrazo" },
  { key: "abdomen", label: "Abdomen" },
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]["key"];
export const MUSCLE_LABEL = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m.key, m.label])) as Record<MuscleGroup, string>;

/** Weekly hard sets per muscle that most hypertrophy research supports (~10–20). */
export const HYPERTROPHY_SETS = { min: 10, max: 20 } as const;
/** Muscles the guideline is shown for (forearms and abs get plenty of indirect work). */
export const MAIN_MUSCLES: MuscleGroup[] = ["pecho", "espalda", "hombros", "biceps", "triceps", "cuadriceps", "isquios", "gluteos", "gemelos"];

/** A working set: not a warm-up and with reps or time. */
const isWorkSet = (s: { warmup?: boolean; reps: number | null; sec?: number }) => !s.warmup && ((s.reps ?? 0) > 0 || (s.sec ?? 0) > 0);

/**
 * Working sets per muscle between two dates (inclusive): a full set for the exercise's main
 * muscle (first of the list) and half a set for each secondary one.
 */
export function setsByMuscle(logs: TrainingLog[], musclesOf: (exerciseId: string) => readonly MuscleGroup[], from: string, to: string) {
  const out = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m.key, 0])) as Record<MuscleGroup, number>;
  for (const l of logs) {
    if (l.date < from || l.date > to) continue;
    for (const ex of workoutExercises(l.details)) {
      const n = ex.sets.filter(isWorkSet).length;
      musclesOf(ex.id).forEach((m, i) => (out[m] += i === 0 ? n : n / 2));
    }
  }
  return out;
}

export type SetsStatus = "low" | "ok" | "high";
export const setsStatus = (n: number): SetsStatus => (n < HYPERTROPHY_SETS.min ? "low" : n > HYPERTROPHY_SETS.max ? "high" : "ok");

/**
 * Strength change in %: per exercise, best estimated 1RM of the last 2 weeks vs. the 4 weeks
 * before; averaged over the exercises trained in both periods. Null when nothing to compare.
 */
export function strengthChangePct(logs: TrainingLog[], today: string) {
  const recentFrom = addDays(today, -14);
  const baseFrom = addDays(today, -42);
  const best = new Map<string, { recent: number; base: number }>();
  for (const l of logs) {
    if (l.date < baseFrom || l.date >= today) continue;
    for (const ex of workoutExercises(l.details)) {
      const top = Math.max(0, ...ex.sets.map((s) => e1rm(s) ?? 0));
      if (!top) continue;
      const b = best.get(ex.id) ?? { recent: 0, base: 0 };
      if (l.date >= recentFrom) b.recent = Math.max(b.recent, top);
      else b.base = Math.max(b.base, top);
      best.set(ex.id, b);
    }
  }
  const pcts = [...best.values()].filter((b) => b.recent && b.base).map((b) => (b.recent / b.base - 1) * 100);
  if (!pcts.length) return null;
  return Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10;
}

export type BulkVerdict = "slow" | "on_track" | "fast" | "no_data";

export interface BulkReviewInput {
  /** Chosen gain rate in kg/week (> 0). */
  targetRateKgWeek: number;
  /** Trend-weight rate over the last 28 days (adaptiveTdee). */
  observedRateKgWeek: number | null;
  confidence: number;
  loggedDays: number;
  /** Verdict of last week's review (two slow weeks in a row are needed to propose more kcal). */
  previousVerdict?: BulkVerdict | null;
}

export interface BulkReview {
  verdict: BulkVerdict;
  /** observed / target */
  ratio: number | null;
  /** Proposed change of the daily kcal target (0 = no proposal). */
  kcalDelta: number;
  message: string;
}

const round25 = (n: number) => Math.round(n / 25) * 25;
const clampDelta = (n: number) => Math.min(150, Math.max(100, round25(Math.abs(n))));

export function bulkReview(i: BulkReviewInput): BulkReview {
  if (i.observedRateKgWeek == null || i.confidence < 0.5 || i.loggedDays < 14)
    return {
      verdict: "no_data",
      ratio: null,
      kcalDelta: 0,
      message: "Aún no hay datos suficientes: hacen falta unas 3–4 semanas con el diario casi completo y pesajes varias veces por semana.",
    };
  const target = i.targetRateKgWeek > 0 ? i.targetRateKgWeek : 0.25;
  const obs = i.observedRateKgWeek;
  const ratio = Math.round((obs / target) * 100) / 100;
  const gapKcal = ((target - obs) * KCAL_PER_KG) / 7;
  const fmt = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("es-ES", { maximumFractionDigits: 2 })} kg/semana`;
  if (ratio < 0.5) {
    const second = i.previousVerdict === "slow";
    const kcalDelta = second ? clampDelta(gapKcal) : 0;
    const what = obs <= 0 ? `El peso no sube (${fmt(obs)})` : `Subes más despacio de lo previsto (${fmt(obs)} frente a ${fmt(target)})`;
    return {
      verdict: "slow",
      ratio,
      kcalDelta,
      message: second ? `${what} por segunda semana seguida. Propuesta: +${kcalDelta} kcal al día.` : `${what}. Si la semana que viene sigue igual, te propondré subir las calorías.`,
    };
  }
  if (ratio > 1.5) {
    const kcalDelta = -clampDelta(gapKcal);
    return {
      verdict: "fast",
      ratio,
      kcalDelta,
      message: `Subes más rápido de lo previsto (${fmt(obs)} frente a ${fmt(target)}): parte será grasa. Propuesta: ${kcalDelta} kcal al día.`,
    };
  }
  return { verdict: "on_track", ratio, kcalDelta: 0, message: `Vas bien: ${fmt(obs)} con un objetivo de ${fmt(target)}.` };
}

export type BodySignalKind = "lean" | "watch" | "fat" | "stalled" | "unknown";

/**
 * «¿Músculo o grasa?» from 4-week changes: trend weight (kg), strength (% e1RM) and waist (cm).
 * A heuristic, worded as such: only measurements over time can tell.
 */
export function bodySignal(i: { weightChangeKg: number | null; strengthChangePct: number | null; waistChangeCm: number | null }): { kind: BodySignalKind; text: string } {
  if (i.weightChangeKg == null) return { kind: "unknown", text: "Faltan pesajes para comparar." };
  const up = i.weightChangeKg >= 0.2;
  const stronger = i.strengthChangePct != null && i.strengthChangePct >= 2;
  const waistUp = i.waistChangeCm != null && i.waistChangeCm > 1;
  const waistKnown = i.waistChangeCm != null;
  if (!up)
    return {
      kind: "stalled",
      text: stronger ? "Ganas fuerza aunque el peso no se mueva. Para ganar músculo suele hacer falta que el peso suba un poco." : "El peso no sube: con este ritmo es difícil ganar músculo.",
    };
  if (waistUp && !stronger) return { kind: "fat", text: "La cintura crece y la fuerza no: probablemente estás ganando más grasa que músculo. Conviene bajar un poco el superávit." };
  if (waistUp) return { kind: "watch", text: "Subes de fuerza, pero la cintura crece deprisa: vigila el ritmo de subida." };
  if (stronger)
    return waistKnown
      ? { kind: "lean", text: "Subes de peso y de fuerza sin que crezca la cintura: buena señal de que es sobre todo músculo." }
      : { kind: "lean", text: "Subes de peso y de fuerza. Mide la cintura cada semana para confirmar que no es grasa." };
  if (i.strengthChangePct == null) return { kind: "watch", text: "El peso sube, pero no hay entrenos con pesos que comparar para saber si es músculo." };
  return { kind: "watch", text: "El peso sube pero la fuerza no: revisa el entrenamiento (progresión y series por músculo)." };
}
