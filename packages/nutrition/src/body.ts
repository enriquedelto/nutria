/** Body measurements and composition: US Navy body-fat estimate, lean/fat mass and FFMI. */
import { daysBetween } from "./tdee-adaptive";

export const MEASURE_SITES = [
  { key: "waist", label: "Cintura" },
  { key: "hips", label: "Cadera" },
  { key: "chest", label: "Pecho" },
  { key: "shoulders", label: "Hombros" },
  { key: "arm", label: "Brazo" },
  { key: "thigh", label: "Muslo" },
  { key: "calf", label: "Gemelo" },
  { key: "neck", label: "Cuello" },
] as const;
export type MeasureSite = (typeof MEASURE_SITES)[number]["key"];
export const SITE_LABEL: Record<string, string> = Object.fromEntries(MEASURE_SITES.map((s) => [s.key, s.label]));

/**
 * US Navy circumference method (metric). Men: neck and waist; women: neck, waist and hips.
 * Typical error ±3–4 points: good for the trend, not for the absolute value.
 */
export function navyBodyFatPct(i: { sex: "male" | "female"; heightCm: number; neckCm: number; waistCm: number; hipCm?: number | null }): number | null {
  const { heightCm: h, neckCm: n, waistCm: w } = i;
  if (!(h > 100 && n > 15 && w > 30)) return null;
  let pct: number;
  if (i.sex === "male") {
    if (w - n <= 0) return null;
    pct = 495 / (1.0324 - 0.19077 * Math.log10(w - n) + 0.15456 * Math.log10(h)) - 450;
  } else {
    if (!i.hipCm || w + i.hipCm - n <= 0) return null;
    pct = 495 / (1.29579 - 0.35004 * Math.log10(w + i.hipCm - n) + 0.221 * Math.log10(h)) - 450;
  }
  if (!Number.isFinite(pct) || pct < 3 || pct > 60) return null;
  return Math.round(pct * 10) / 10;
}

export interface BodyComposition {
  fatKg: number;
  leanKg: number;
  /** Fat-free mass index (kg/m²). */
  ffmi: number;
  /** FFMI normalised to 1.80 m. */
  ffmiNorm: number;
}

export function bodyComposition(weightKg: number, bodyFatPct: number, heightCm: number): BodyComposition {
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const fat = (weightKg * bodyFatPct) / 100;
  const lean = weightKg - fat;
  const m = heightCm / 100;
  const ffmi = lean / (m * m);
  return { fatKg: r1(fat), leanKg: r1(lean), ffmi: r1(ffmi), ffmiNorm: r1(ffmi + 6.1 * (1.8 - m)) };
}

/** Rough reading of a normalised FFMI (men; women run about 3 points lower). */
export function ffmiLabel(ffmiNorm: number, sex: "male" | "female"): string {
  const v = sex === "female" ? ffmiNorm + 3 : ffmiNorm;
  return v < 18 ? "por debajo de la media" : v < 20 ? "en la media" : v < 22 ? "por encima de la media" : v < 25 ? "muy musculado" : "cerca del límite natural";
}

export interface CompositionPoint extends BodyComposition {
  date: string;
  weightKg: number;
  bodyFatPct: number;
  /** measured = entered with the weigh-in (scale, calipers…); navy = estimated from the tape. */
  source: "measured" | "navy";
}

/**
 * Composition over time. A measured % (weigh-in) wins over the tape estimate on the same day.
 * Tape estimates use the measurements of one day and the closest weigh-in within a week.
 */
export function compositionSeries(i: {
  sex: "male" | "female" | null;
  heightCm: number | null;
  weights: { date: string; kg: number; bodyFatPct?: number | null }[];
  measures: { date: string; site: string; cm: number }[];
}): CompositionPoint[] {
  if (!i.heightCm) return [];
  const h = i.heightCm;
  const out = new Map<string, CompositionPoint>();
  const nearestWeight = (date: string) => {
    let best: { kg: number; d: number } | null = null;
    for (const w of i.weights) {
      const d = Math.abs(daysBetween(w.date, date));
      if (d <= 7 && (!best || d < best.d)) best = { kg: w.kg, d };
    }
    return best?.kg ?? null;
  };
  if (i.sex) {
    const byDate = new Map<string, Record<string, number>>();
    for (const m of i.measures) byDate.set(m.date, { ...(byDate.get(m.date) ?? {}), [m.site]: m.cm });
    for (const [date, s] of byDate) {
      if (s.neck == null || s.waist == null) continue;
      const pct = navyBodyFatPct({ sex: i.sex, heightCm: h, neckCm: s.neck, waistCm: s.waist, hipCm: s.hips });
      const kg = nearestWeight(date);
      if (pct == null || kg == null) continue;
      out.set(date, { date, weightKg: kg, bodyFatPct: pct, source: "navy", ...bodyComposition(kg, pct, h) });
    }
  }
  for (const w of i.weights) {
    if (w.bodyFatPct == null || w.bodyFatPct < 3 || w.bodyFatPct > 60) continue;
    out.set(w.date, { date: w.date, weightKg: w.kg, bodyFatPct: w.bodyFatPct, source: "measured", ...bodyComposition(w.kg, w.bodyFatPct, h) });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Progress photos every 4 weeks: due on day 28, 56… after the last one. */
export function photoReminderDue(lastPhotoDate: string | null, today: string) {
  if (!lastPhotoDate) return false;
  const d = daysBetween(lastPhotoDate, today);
  return d >= 28 && d % 28 === 0;
}
