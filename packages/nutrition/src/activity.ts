/** M7 exercise (MET), steps, fasting; M8 sleep/cycle helpers; M3 alcohol units. */

/** kcal = MET × kg × hours. Net of resting (subtract 1 MET) to avoid double counting with TDEE. */
export function exerciseKcal(met: number, weightKg: number, minutes: number, net = true): number {
  const m = net ? Math.max(0, met - 1) : met;
  return Math.round(m * weightKg * (minutes / 60));
}

/** Strength session estimate when only duration/volume is known (e.g. openGym workouts). */
export function strengthSessionKcal(weightKg: number, minutes: number, volumeKg?: number): number {
  // Vigorous resistance training ≈ 6 MET, moderate ≈ 3.5; scale intensity by volume per minute.
  const vpm = volumeKg && minutes ? volumeKg / minutes : 0;
  const met = vpm > 250 ? 6 : vpm > 100 ? 5 : 3.5;
  return exerciseKcal(met, weightKg, minutes);
}

/** Steps → kcal (≈0.04 kcal/step at 70 kg, scaled by weight), net of resting. */
export function stepsKcal(steps: number, weightKg: number): number {
  return Math.round(steps * 0.04 * (weightKg / 70) * 0.8);
}

export interface FastingStatus {
  elapsedH: number;
  remainingH: number;
  pct: number;
  done: boolean;
  phase: "anabolic" | "catabolic" | "fat_burning" | "ketosis" | "deep_ketosis";
}

export function fastingStatus(startedAt: Date, targetHours: number, now: Date = new Date()): FastingStatus {
  const elapsedH = Math.max(0, (now.getTime() - startedAt.getTime()) / 3_600_000);
  const phase: FastingStatus["phase"] =
    elapsedH < 4 ? "anabolic" : elapsedH < 12 ? "catabolic" : elapsedH < 18 ? "fat_burning" : elapsedH < 24 ? "ketosis" : "deep_ketosis";
  return {
    elapsedH: Math.round(elapsedH * 100) / 100,
    remainingH: Math.max(0, Math.round((targetHours - elapsedH) * 100) / 100),
    pct: Math.min(1, elapsedH / targetHours),
    done: elapsedH >= targetHours,
    phase,
  };
}

export const FASTING_PROTOCOLS = [
  { code: "12:12", nameEs: "12:12", fastHours: 12, description: "Ayuno nocturno suave." },
  { code: "14:10", nameEs: "14:10", fastHours: 14, description: "Intermedio." },
  { code: "16:8", nameEs: "16:8", fastHours: 16, description: "El más habitual: 16 h de ayuno y ventana de 8 h." },
  { code: "18:6", nameEs: "18:6", fastHours: 18, description: "Ventana de 6 h." },
  { code: "20:4", nameEs: "20:4", fastHours: 20, description: "Ventana de 4 h." },
  { code: "omad", nameEs: "Una comida al día", fastHours: 23, description: "OMAD." },
  { code: "5:2", nameEs: "5:2", fastHours: null, description: "Dos días por semana de ~500–600 kcal." },
  { code: "custom", nameEs: "Personalizado", fastHours: null, description: "Duración libre." },
] as const;

/** Spanish standard drink unit (UBE) = 10 g pure alcohol. */
export function alcoholGrams(ml: number, abvPct: number): number {
  return ml * (abvPct / 100) * 0.789;
}
export const ubes = (grams: number) => Math.round((grams / 10) * 10) / 10;

/* ----------------------------------- Cycle ----------------------------------- */

export type CyclePhase = "menstrual" | "follicular" | "ovulation" | "luteal";

export function averageCycleLength(startDates: string[]): number {
  const sorted = [...startDates].sort();
  const lens: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const d = (Date.parse(sorted[i]!) - Date.parse(sorted[i - 1]!)) / 86_400_000;
    if (d >= 18 && d <= 45) lens.push(d);
  }
  if (!lens.length) return 28;
  return Math.round(lens.slice(-6).reduce((a, b) => a + b, 0) / Math.min(6, lens.length));
}

export function cyclePhase(
  lastStart: string,
  date: string,
  cycleLength = 28,
  periodLength = 5,
): { day: number; phase: CyclePhase; nextStart: string } {
  const diff = Math.floor((Date.parse(date) - Date.parse(lastStart)) / 86_400_000);
  const day = (((diff % cycleLength) + cycleLength) % cycleLength) + 1;
  const ovulationDay = cycleLength - 14;
  const phase: CyclePhase =
    day <= periodLength ? "menstrual" : day < ovulationDay - 1 ? "follicular" : day <= ovulationDay + 1 ? "ovulation" : "luteal";
  const cyclesAhead = Math.floor(diff / cycleLength) + 1;
  const next = new Date(Date.parse(lastStart) + cyclesAhead * cycleLength * 86_400_000).toISOString().slice(0, 10);
  return { day, phase, nextStart: next };
}

export const CYCLE_PHASE_NOTES: Record<CyclePhase, string> = {
  menstrual: "Pérdida de hierro: prioriza alimentos ricos en hierro y vitamina C.",
  follicular: "Energía y sensibilidad a la insulina suelen ser mejores.",
  ovulation: "Pico de energía en muchas personas.",
  luteal: "El gasto puede subir ~100–300 kcal y el apetito aumentar; es normal retener líquidos (el peso puede subir sin ganar grasa).",
};

/* ----------------------------------- Sleep ----------------------------------- */

export function sleepHours(bedtime: Date, wake: Date): number {
  return Math.round(((wake.getTime() - bedtime.getTime()) / 3_600_000) * 100) / 100;
}
