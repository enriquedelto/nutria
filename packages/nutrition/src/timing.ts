/** Protein per meal and nutrient timing around training (for people training or gaining). */

/** Ideal protein per meal: 0.4 g/kg, at least 25 g (leucine threshold for most adults). */
export const proteinDoseG = (weightKg: number) => Math.max(25, Math.round(0.4 * weightKg));

export type MealProteinStatus = "ok" | "near" | "low";
/** How a meal's protein compares with the ideal dose (≥ 90 % ok, ≥ 60 % near). */
export function mealProteinStatus(protein: number, dose: number): MealProteinStatus {
  if (dose <= 0) return "ok";
  const r = protein / dose;
  return r >= 0.9 ? "ok" : r >= 0.6 ? "near" : "low";
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHMM = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Median of clock times ("HH:MM"), rounded to 5 min; null without samples. */
export function medianTime(times: string[]): string | null {
  if (!times.length) return null;
  const s = times.map(toMin).sort((a, b) => a - b);
  const mid = s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  return toHHMM(Math.round(mid / 5) * 5);
}

export interface TrainingTiming {
  /** Usual (or today's real) start. */
  start: string;
  end: string;
  /** Pre-workout meal window: 1–3 h before. */
  preFrom: string;
  preTo: string;
  /** Post-workout: within 2 h after finishing. */
  postUntil: string;
  /** Protein after training: 0.3–0.4 g/kg. */
  postProteinG: [number, number];
  /** Carbs before training: ~1 g/kg. */
  preCarbsG: number;
}

export function trainingTiming(start: string, durationMin: number, weightKg: number): TrainingTiming {
  const s = toMin(start);
  const e = s + Math.max(20, durationMin);
  return {
    start: toHHMM(s),
    end: toHHMM(e),
    preFrom: toHHMM(s - 180),
    preTo: toHHMM(s - 60),
    postUntil: toHHMM(e + 120),
    postProteinG: [Math.round(0.3 * weightKg), Math.round(0.4 * weightKg)],
    preCarbsG: Math.round(weightKg),
  };
}

/** Where "now" falls around the session. */
export type TimingPhase = "early" | "pre" | "soon" | "during" | "post" | "late";
export function timingPhase(t: TrainingTiming, now: string): TimingPhase {
  const n = toMin(now);
  const s = toMin(t.start);
  const e = s + ((toMin(t.end) - s + 1440) % 1440);
  if (n < s - 180) return "early";
  if (n < s - 60) return "pre";
  if (n < s) return "soon";
  if (n < e) return "during";
  if (n <= e + 120) return "post";
  return "late";
}

/** Evening protein reminder: grams still missing, or 0 when it is not worth a nudge (< 20 g). */
export function proteinGapG(target: number, eaten: number) {
  const gap = Math.round(target - eaten);
  return gap >= 20 ? gap : 0;
}
