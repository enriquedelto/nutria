/**
 * Caffeine in the body over the day: one-compartment model with first-order absorption
 * (bioavailability ≈ 1), A(t) = D·ka/(ka−ke)·(e^(−ke·t) − e^(−ka·t)).
 *
 * - ka = 5 h⁻¹ puts the peak ~45 min after intake (Tmax 30–60 min with coffee).
 * - Half-life ~5 h in healthy adults, 2–10 h between people (shorter in smokers, longer with oral
 *   contraceptives and much longer in pregnancy).
 * - Sleep: Gardiner et al. 2023 meta-analysis (Sleep Med Rev, doi:10.1016/j.smrv.2023.101764) —
 *   107 mg should be taken ≥ 8.8 h and 217 mg ≥ 13.2 h before bed. With t½ = 5 h both leave
 *   ~30–35 mg in the body at bedtime, so ≤ 30 mg at bedtime is used as the threshold.
 * - Training: 3–6 mg/kg about 60 min before (ISSN position stand 2021, Guest et al.,
 *   doi:10.1186/s12970-020-00383-4); the model peak (~45 min) is used as lead time.
 *
 * Times are minutes from 00:00 of the day being viewed (negative = the day before, > 1440 = the
 * next day).
 */

export interface CaffeineDose {
  /** Minutes from 00:00 of the viewed day. */
  at: number;
  mg: number;
}

export const CAFFEINE_KA_PER_H = 5;
export const CAFFEINE_DEFAULT_HALF_LIFE_H = 5;
export const CAFFEINE_PREGNANCY_HALF_LIFE_H = 10;
/** mg left in the body at bedtime below which sleep is not measurably affected. */
export const CAFFEINE_SLEEP_MAX_MG = 30;
export const CAFFEINE_DAILY_MAX_MG = 400;
export const CAFFEINE_HALF_LIVES = [
  { h: 3, label: "Rápida (3 h)", hint: "fumadores" },
  { h: 5, label: "Normal (5 h)", hint: "la mayoría de adultos" },
  { h: 8, label: "Lenta (8 h)", hint: "anticonceptivos orales o metabolizador lento" },
] as const;

/** Share of a dose still in the body `hours` after intake (0 before it). */
export function caffeineFraction(hours: number, halfLifeH = CAFFEINE_DEFAULT_HALF_LIFE_H): number {
  if (hours <= 0) return 0;
  const ka = CAFFEINE_KA_PER_H;
  const ke = Math.LN2 / halfLifeH;
  return (ka / (ka - ke)) * (Math.exp(-ke * hours) - Math.exp(-ka * hours));
}

/** Minutes from intake to the peak amount in the body. */
export function caffeinePeakDelayMin(halfLifeH = CAFFEINE_DEFAULT_HALF_LIFE_H): number {
  const ka = CAFFEINE_KA_PER_H;
  const ke = Math.LN2 / halfLifeH;
  return (Math.log(ka / ke) / (ka - ke)) * 60;
}

/** mg of caffeine in the body at minute `t`. */
export function caffeineAt(doses: CaffeineDose[], t: number, halfLifeH = CAFFEINE_DEFAULT_HALF_LIFE_H): number {
  return doses.reduce((s, d) => s + d.mg * caffeineFraction((t - d.at) / 60, halfLifeH), 0);
}

/** Points every `stepMin` minutes between `from` and `to`. */
export function caffeineCurve(doses: CaffeineDose[], opts: { from: number; to: number; stepMin?: number; halfLifeH?: number }): { t: number; mg: number }[] {
  const step = opts.stepMin ?? 10;
  const out: { t: number; mg: number }[] = [];
  for (let t = opts.from; t <= opts.to; t += step) out.push({ t, mg: Math.round(caffeineAt(doses, t, opts.halfLifeH) * 10) / 10 });
  return out;
}

/** Largest single dose taken at `at` that keeps the body under the sleep threshold at `bedtime`. */
export function caffeineMaxForSleep(doses: CaffeineDose[], at: number, bedtime: number, halfLifeH = CAFFEINE_DEFAULT_HALF_LIFE_H): number {
  const room = CAFFEINE_SLEEP_MAX_MG - caffeineAt(doses, bedtime, halfLifeH);
  if (room <= 0) return 0;
  const f = caffeineFraction((bedtime - at) / 60, halfLifeH);
  return f <= 0 ? Infinity : room / f;
}

/** Latest intake minute for `mg` that still leaves ≤ the threshold at `bedtime` (null if impossible). */
export function caffeineLatestFor(doses: CaffeineDose[], mg: number, bedtime: number, halfLifeH = CAFFEINE_DEFAULT_HALF_LIFE_H): number | null {
  const room = CAFFEINE_SLEEP_MAX_MG - caffeineAt(doses, bedtime, halfLifeH);
  if (room <= 0) return null;
  if (mg <= room) return bedtime;
  // After the peak the remaining share only falls: bisect the hours before bed.
  let lo = caffeinePeakDelayMin(halfLifeH) / 60;
  let hi = 72;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (mg * caffeineFraction(mid, halfLifeH) > room) lo = mid;
    else hi = mid;
  }
  return bedtime - hi * 60;
}

export interface CaffeinePlan {
  /** Intake minute that puts the peak at the start of training (null without training). */
  idealAt: number | null;
  /** 3 mg/kg rounded to 10 mg, within what is left of the 400 mg/day. */
  suggestedMg: number;
  /** Caffeine already logged today (mg). */
  takenMg: number;
  /** mg in the body at bedtime with the logged doses. */
  residualAtBed: number;
}

export function caffeinePlan(input: { doses: CaffeineDose[]; trainingStart: number | null; bedtime: number; weightKg: number | null; halfLifeH?: number }): CaffeinePlan {
  const h = input.halfLifeH ?? CAFFEINE_DEFAULT_HALF_LIFE_H;
  const lead = Math.round(caffeinePeakDelayMin(h) / 5) * 5;
  const takenMg = input.doses.filter((d) => d.at >= 0 && d.at < 1440).reduce((s, d) => s + d.mg, 0);
  const byWeight = input.weightKg ? Math.round((3 * input.weightKg) / 10) * 10 : 200;
  return {
    idealAt: input.trainingStart != null ? input.trainingStart - lead : null,
    suggestedMg: Math.max(0, Math.min(byWeight, CAFFEINE_DAILY_MAX_MG - takenMg)),
    takenMg: Math.round(takenMg),
    residualAtBed: Math.round(caffeineAt(input.doses, input.bedtime, h)),
  };
}

/** "HH:MM" → minutes. */
export const clockToMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** Minutes (any day offset) → "HH:MM". */
export function minutesToClock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
