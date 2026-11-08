/**
 * Adaptive TDEE (energy expenditure from real intake vs. trend weight change),
 * under-logging detection and weight forecast.
 */
import { KCAL_PER_KG } from "./targets";

export interface DayPoint {
  date: string; // YYYY-MM-DD
  intakeKcal?: number | null; // null/undefined = not logged
  weightKg?: number | null;
  /** User marked the day as fully logged. Unmarked days with very low intake are ignored. */
  complete?: boolean;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** Fill a continuous daily range (missing days = empty points). */
export function continuous(points: DayPoint[], from: string, to: string): DayPoint[] {
  const map = new Map(points.map((p) => [p.date, p]));
  const out: DayPoint[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(map.get(d) ?? { date: d });
  return out;
}

/**
 * Exponentially smoothed trend weight (alpha 0.1, "Hacker's Diet"). Days without weigh-in carry
 * the trend forward. Returns null until the first weigh-in.
 */
export function trendWeights(series: DayPoint[], alpha = 0.1): (number | null)[] {
  let t: number | null = null;
  return series.map((p) => {
    if (p.weightKg != null) t = t == null ? p.weightKg : t + alpha * (p.weightKg - t);
    return t;
  });
}

/** Least-squares slope of y over x. */
export function slope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export interface AdaptiveResult {
  windowDays: number;
  loggedDays: number;
  weighIns: number;
  avgIntake: number | null;
  trendStart: number | null;
  trendEnd: number | null;
  /** kg/week from trend regression. */
  observedRateKgWeek: number | null;
  adaptiveTdee: number | null;
  /** 0..1 */
  confidence: number;
  /** Blended estimate (adaptive weighted by confidence, else formula). */
  estimatedTdee: number;
  underLoggingSuspected: boolean;
  reasons: string[];
}

export interface AdaptiveOptions {
  formulaTdee: number;
  bmr: number;
  windowDays?: number; // default 28
  minDays?: number; // default 14
}

export function adaptiveTdee(points: DayPoint[], endDate: string, opts: AdaptiveOptions): AdaptiveResult {
  const windowDays = opts.windowDays ?? 28;
  const minDays = opts.minDays ?? 14;
  const start = addDays(endDate, -(windowDays - 1));
  // Warm up trend with up to 14 extra days before the window.
  const warm = continuous(points, addDays(start, -14), endDate);
  const trend = trendWeights(warm);
  const offset = 14;
  const series = warm.slice(offset);
  const trendWin = trend.slice(offset);

  // Intake: ignore days not logged, and suspicious partial days (< 50% BMR and not marked complete).
  const intakeDays = series.filter(
    (p) => p.intakeKcal != null && p.intakeKcal > 0 && (p.complete || p.intakeKcal >= opts.bmr * 0.5),
  );
  const loggedDays = intakeDays.length;
  const weighIns = series.filter((p) => p.weightKg != null).length;
  const avgIntake = loggedDays ? intakeDays.reduce((s, p) => s + p.intakeKcal!, 0) / loggedDays : null;

  const xs: number[] = [];
  const ys: number[] = [];
  trendWin.forEach((t, i) => {
    if (t != null) {
      xs.push(i);
      ys.push(t);
    }
  });
  const kgPerDay = xs.length >= 2 ? slope(xs, ys) : null;
  const trendStart = ys[0] ?? null;
  const trendEnd = ys.at(-1) ?? null;

  const reasons: string[] = [];
  let adaptive: number | null = null;
  if (avgIntake != null && kgPerDay != null) adaptive = avgIntake - kgPerDay * KCAL_PER_KG;

  const span = xs.length ? xs.at(-1)! - xs[0]! + 1 : 0;
  let confidence = 0;
  if (adaptive != null && span >= minDays && loggedDays >= minDays * 0.7 && weighIns >= 4) {
    const cLogged = Math.min(1, loggedDays / (windowDays * 0.85));
    const cWeigh = Math.min(1, weighIns / (windowDays / 3));
    const cSpan = Math.min(1, span / windowDays);
    confidence = Math.max(0, Math.min(1, cLogged * 0.5 + cWeigh * 0.3 + cSpan * 0.2));
  } else {
    if (span < minDays) reasons.push(`Faltan datos: hacen falta al menos ${minDays} días con pesajes.`);
    if (loggedDays < minDays * 0.7) reasons.push("Pocos días registrados en el periodo.");
    if (weighIns < 4) reasons.push("Pocos pesajes (mínimo 4 en el periodo).");
  }

  let underLogging = false;
  if (adaptive != null && confidence > 0.3) {
    if (adaptive < opts.bmr * 1.05 || adaptive < opts.formulaTdee * 0.72) {
      underLogging = true;
      reasons.push(
        "El gasto calculado con tus registros es mucho menor de lo esperable: es probable que falten comidas o que las raciones sean mayores de lo anotado.",
      );
    }
  }
  if (adaptive != null && adaptive > opts.formulaTdee * 1.6) reasons.push("Gasto muy superior al esperado; revisa pesajes atípicos.");

  // Clamp to plausible range before blending
  const plausible = adaptive == null ? null : Math.min(Math.max(adaptive, opts.bmr), opts.formulaTdee * 1.6);
  const effConfidence = underLogging ? confidence * 0.3 : confidence;
  const estimated = plausible == null ? opts.formulaTdee : effConfidence * plausible + (1 - effConfidence) * opts.formulaTdee;

  return {
    windowDays,
    loggedDays,
    weighIns,
    avgIntake: avgIntake == null ? null : Math.round(avgIntake),
    trendStart,
    trendEnd,
    observedRateKgWeek: kgPerDay == null ? null : kgPerDay * 7,
    adaptiveTdee: adaptive == null ? null : Math.round(adaptive),
    confidence: Math.round(confidence * 100) / 100,
    estimatedTdee: Math.round(estimated),
    underLoggingSuspected: underLogging,
    reasons,
  };
}

export interface Forecast {
  days: number;
  date: string;
  weightKg: number;
}

/** Weight forecast assuming planned intake vs. estimated TDEE (simple energy balance). */
export function forecastWeight(opts: {
  fromDate: string;
  currentTrendKg: number;
  plannedIntake: number;
  tdee: number;
  horizons?: number[];
}): Forecast[] {
  const perDay = (opts.plannedIntake - opts.tdee) / KCAL_PER_KG;
  return (opts.horizons ?? [30, 60, 90]).map((d) => ({
    days: d,
    date: addDays(opts.fromDate, d),
    weightKg: Math.round((opts.currentTrendKg + perDay * d) * 10) / 10,
  }));
}

/** Days to reach a target weight at the expected rate (null if moving away or no change). */
export function daysToGoal(currentKg: number, targetKg: number, rateKgWeek: number): number | null {
  const diff = targetKg - currentKg;
  if (rateKgWeek === 0 || Math.sign(diff) !== Math.sign(rateKgWeek)) return null;
  return Math.ceil(Math.abs(diff / (rateKgWeek / 7)));
}

/** Compare expected vs observed weekly change (from intake) to flag adherence/under-logging. */
export function expectedRateKgWeek(avgIntake: number, tdee: number): number {
  return ((avgIntake - tdee) * 7) / KCAL_PER_KG;
}
