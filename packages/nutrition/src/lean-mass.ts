/**
 * Is lean mass being lost? Three signals that are available without a food diary: training done vs.
 * planned, trend weight with the waist, and strength (estimated 1RM). Detraining shrinks muscle within
 * weeks and the scale alone cannot tell it from fat loss; strength and waist can. A heuristic, worded
 * as such — only body measurements over time confirm it.
 */
import { addDays, daysBetween } from "./tdee-adaptive";
import { e1rm, workoutExercises, type TrainingLog } from "./training";

/** Recent best e1RM (last 3 weeks) vs. the best of the 9 weeks before, averaged over shared lifts. */
export function strengthTrend(logs: TrainingLog[], today: string): { pct: number | null; lifts: number } {
  const recentFrom = addDays(today, -21);
  const baseFrom = addDays(today, -84);
  const best = new Map<string, { recent: number; base: number }>();
  for (const l of logs) {
    if (l.date < baseFrom || l.date > today) continue;
    for (const ex of workoutExercises(l.details)) {
      const top = Math.max(0, ...ex.sets.map((s) => e1rm(s) ?? 0));
      if (!top) continue;
      const key = ex.id || ex.name;
      const b = best.get(key) ?? { recent: 0, base: 0 };
      if (l.date >= recentFrom) b.recent = Math.max(b.recent, top);
      else b.base = Math.max(b.base, top);
      best.set(key, b);
    }
  }
  const pcts = [...best.values()].filter((b) => b.recent && b.base).map((b) => (b.recent / b.base - 1) * 100);
  return { pct: pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : null, lifts: pcts.length };
}

export interface LiftSeries {
  key: string;
  name: string;
  /** Best estimated 1RM per session (kg), oldest first. */
  points: { date: string; value: number }[];
}

/** Multi-joint lifts: the best read of whole-body strength (and of lean mass) between measurements. */
const COMPOUND = /press (de )?banca|bench press|sentadilla(?! b[uú]lgara)|squat|peso muerto(?! rumano)|deadlift|press (militar|de hombros?)|overhead press|dominada|pull.?up|remo con barra|barbell row|hip thrust/i;

/** e1RM over time since `from` (at least 3 sessions each): multi-joint lifts first, then the most trained. */
export function liftSeries(logs: TrainingLog[], from: string, top = 4): LiftSeries[] {
  const by = new Map<string, LiftSeries>();
  for (const l of [...logs].sort((a, b) => a.date.localeCompare(b.date))) {
    if (l.date < from) continue;
    for (const ex of workoutExercises(l.details)) {
      const v = Math.max(0, ...ex.sets.map((s) => e1rm(s) ?? 0));
      if (!v) continue;
      const key = ex.id || ex.name;
      const s = by.get(key) ?? { key, name: ex.name, points: [] };
      const last = s.points.at(-1);
      if (last?.date === l.date) last.value = Math.max(last.value, Math.round(v * 10) / 10);
      else s.points.push({ date: l.date, value: Math.round(v * 10) / 10 });
      by.set(key, s);
    }
  }
  return [...by.values()]
    .filter((s) => s.points.length >= 3)
    .sort((a, b) => Number(COMPOUND.test(b.name)) - Number(COMPOUND.test(a.name)) || b.points.length - a.points.length)
    .slice(0, top);
}

export type LeanMassLevel = "ok" | "watch" | "alert" | "unknown";

export interface LeanMassInput {
  /** Planned sessions per week (training days), null if unknown. */
  plannedPerWeek: number | null;
  sessionsLast28: number;
  /** Days since the last workout (null = none in the window). */
  daysSinceLast: number | null;
  /** Trend-weight change over the last 4 weeks (kg). */
  weightChangeKg: number | null;
  strengthPct: number | null;
  /** Waist change over ≥ 3 weeks (cm), null if not measured. */
  waistChangeCm: number | null;
  /** Losing weight on purpose: a falling scale is expected, only strength and training matter. */
  cutting?: boolean;
}

export interface LeanMassCheck {
  level: LeanMassLevel;
  /** Done / planned over 4 weeks (0..1+), null without a plan. */
  adherence: number | null;
  reasons: string[];
  text: string;
}

const kg = (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n).toLocaleString("es-ES", { maximumFractionDigits: 1 })} kg`;
const pct = (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`;

export function leanMassCheck(i: LeanMassInput): LeanMassCheck {
  const planned4 = i.plannedPerWeek ? i.plannedPerWeek * 4 : null;
  const adherence = planned4 ? Math.round((i.sessionsLast28 / planned4) * 100) / 100 : null;
  const reasons: string[] = [];
  const noTraining = i.daysSinceLast == null || i.daysSinceLast >= 14;
  const lowAdherence = (adherence != null && adherence < 0.6) || noTraining;
  const weightDown = !i.cutting && i.weightChangeKg != null && i.weightChangeKg <= -1;
  const strengthDown = i.strengthPct != null && i.strengthPct <= -5;
  const waistSteady = i.waistChangeCm != null && i.waistChangeCm > -0.5;

  if (i.daysSinceLast == null) reasons.push("Ningún entreno registrado en las últimas semanas.");
  else if (i.daysSinceLast >= 14) reasons.push(`${i.daysSinceLast} días sin entrenar.`);
  if (adherence != null && adherence < 0.6) reasons.push(`Entrenos de las últimas 4 semanas: ${i.sessionsLast28} de ${planned4} planificados (${Math.round(adherence * 100)} %).`);
  if (strengthDown) reasons.push(`Fuerza ${pct(i.strengthPct!)} (mejor 1RM estimado de las últimas 3 semanas frente a las 9 anteriores).`);
  if (weightDown) reasons.push(`Peso ${kg(i.weightChangeKg!)} en 4 semanas${waistSteady ? ` con la cintura igual (${i.waistChangeCm! >= 0 ? "+" : "−"}${Math.abs(i.waistChangeCm!).toLocaleString("es-ES")} cm)` : ""}.`);

  if (i.plannedPerWeek == null && i.daysSinceLast == null && i.weightChangeKg == null)
    return { level: "unknown", adherence, reasons: [], text: "Sin datos de entreno ni de peso para valorarlo." };

  const alert = (weightDown && (strengthDown || waistSteady)) || (lowAdherence && strengthDown) || (i.daysSinceLast != null && i.daysSinceLast >= 21) || (i.daysSinceLast == null && i.plannedPerWeek != null);
  if (alert)
    return {
      level: "alert",
      adherence,
      reasons,
      text: weightDown && (strengthDown || waistSteady)
        ? "Probable pérdida de masa magra: baja el peso sin que baje la grasa (cintura igual) o con menos fuerza. Vuelve a tu frecuencia de entreno; si no puedes, mantén al menos 2 sesiones con cargas pesadas por semana."
        : "Riesgo de perder masa magra: entrenas mucho menos de lo previsto. Con ~1/3 del volumen y cargas pesadas se mantiene el músculo: al menos 2 sesiones por semana.",
    };
  if (lowAdherence || strengthDown || (weightDown && i.waistChangeCm == null))
    return {
      level: "watch",
      adherence,
      reasons: weightDown && i.waistChangeCm == null ? [...reasons, "Mide la cintura cada semana para saber si lo que baja es grasa o músculo."] : reasons,
      text: "Vigila: alguna señal va en contra (menos entrenos, menos fuerza o menos peso sin saber de dónde).",
    };
  return { level: "ok", adherence, reasons, text: "Sin señales de pérdida de masa magra." };
}

/** Progress photos: due when there is none yet or 4 weeks have passed; which poses the last session lacks. */
export function photoStatus(photos: { date: string; pose: string }[], today: string) {
  const last = photos.reduce<string | null>((m, p) => (!m || p.date > m ? p.date : m), null);
  const daysSince = last ? daysBetween(last, today) : null;
  const poses = new Set(photos.filter((p) => p.date === last).map((p) => p.pose));
  return {
    due: daysSince == null || daysSince >= 28,
    last,
    daysSince,
    /** Poses missing from the last session (front, side, back), so a session can be completed. */
    missing: (["front", "side", "back"] as const).filter((p) => !poses.has(p)),
  };
}
