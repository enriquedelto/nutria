/**
 * Best time to train within the gym's opening hours, from what the person's day allows:
 *
 * - Caffeine: a pre-workout dose (3 mg/kg, ISSN 2021) ~45 min before must leave ≤ 30 mg in the body
 *   at bedtime (Gardiner et al. 2023). The later the session, the less fits.
 * - Pre-workout meal: 1–3 h before, after getting up. Very early sessions leave no room for it.
 * - Sleep: finishing well before bed (vigorous exercise in the last hour can delay sleep onset;
 *   earlier evening exercise does not hurt sleep — Stutz et al. 2019).
 * - Strength is a few % higher in the late afternoon, but adapts to the time one trains regularly
 *   (Grgic et al. 2019), so time of day itself is not scored.
 *
 * Times are minutes from 00:00 (bedtime after midnight > 1440).
 */
import { caffeineLatestFor, caffeineMaxForSleep, caffeinePeakDelayMin, CAFFEINE_DEFAULT_HALF_LIFE_H, type CaffeineDose } from "./caffeine";

export interface TimeWindow {
  from: number;
  to: number;
}

export interface TrainingTimeOption {
  start: number;
  end: number;
  /** 0..1 */
  score: number;
  /** Pre-workout caffeine that fits (mg) and the suggested dose. */
  caffeine: { at: number; maxMg: number; suggestedMg: number; fits: boolean };
  /** Pre-workout meal window, clipped to after waking; `ok` = at least 1 h before with the full window open. */
  meal: { from: number; to: number; ok: boolean; snackOnly: boolean };
  /** Minutes between the end of the session and bedtime. */
  bedGapMin: number;
}

export interface TrainingTimePlan {
  options: TrainingTimeOption[];
  /** Best start of each opening window (same order as the windows). */
  perWindow: (TrainingTimeOption | null)[];
  best: TrainingTimeOption | null;
  /** Latest start that still allows the full suggested caffeine dose (null if none / no window). */
  latestStartForFullCaffeine: number | null;
}

const SUGGESTED_MG_PER_KG = 3;
/** The dose "fits" when ≥ 90 % of it does: the 30 mg threshold and the half-life are estimates. */
const FITS_SHARE = 0.9;
/** Earliest one eats after getting up. */
const BREAKFAST_AFTER_WAKE_MIN = 30;

export function bestTrainingTimes(input: {
  windows: TimeWindow[];
  durationMin: number;
  wake: number;
  bedtime: number;
  weightKg: number;
  halfLifeH?: number;
  /** Usual caffeine apart from the pre-workout dose (e.g. the morning coffee). */
  otherCaffeine?: CaffeineDose[];
  stepMin?: number;
}): TrainingTimePlan {
  const h = input.halfLifeH ?? CAFFEINE_DEFAULT_HALF_LIFE_H;
  const lead = Math.round(caffeinePeakDelayMin(h) / 5) * 5;
  const step = input.stepMin ?? 15;
  const suggestedMg = Math.min(400, Math.round((SUGGESTED_MG_PER_KG * input.weightKg) / 10) * 10);
  const eatFrom = input.wake + BREAKFAST_AFTER_WAKE_MIN;
  // A usual coffee in the 2 h before the session is the pre-workout dose itself.
  const others = (doseAt: number) => (input.otherCaffeine ?? []).filter((d) => d.at < doseAt - 120 || d.at > doseAt + 60);

  const option = (start: number): TrainingTimeOption => {
    const end = start + input.durationMin;
    const doseAt = start - lead;
    const maxMg = caffeineMaxForSleep(others(doseAt), doseAt, input.bedtime, h);
    const mealFrom = Math.max(start - 180, eatFrom);
    const mealTo = start - 60;
    const mealOk = mealTo >= eatFrom && mealTo - mealFrom >= 60;
    const snackOnly = !mealOk && start - eatFrom >= 30;
    const bedGapMin = input.bedtime - end;
    const caffeineScore = Math.min(1, maxMg / suggestedMg);
    const mealScore = mealOk ? 1 : mealTo >= eatFrom ? 0.7 : snackOnly ? 0.4 : 0.1;
    const sleepScore = bedGapMin >= 120 ? 1 : bedGapMin >= 60 ? 0.6 : 0.2;
    return {
      start,
      end,
      score: Math.round((0.5 * caffeineScore + 0.35 * mealScore + 0.15 * sleepScore) * 100) / 100,
      caffeine: { at: doseAt, maxMg: Number.isFinite(maxMg) ? Math.floor(maxMg / 10) * 10 : suggestedMg, suggestedMg, fits: maxMg >= suggestedMg * FITS_SHARE },
      meal: { from: mealFrom, to: mealTo, ok: mealOk, snackOnly },
      bedGapMin,
    };
  };

  const perWindowOptions = input.windows.map((w) => {
    const xs: TrainingTimeOption[] = [];
    for (let s = w.from; s + input.durationMin <= w.to; s += step) xs.push(option(s));
    return xs;
  });
  const options = perWindowOptions.flat();
  // Best = highest score; ties go to the earliest start (more of the day left, more caffeine headroom).
  const pick = (xs: TrainingTimeOption[]) => xs.reduce<TrainingTimeOption | null>((b, o) => (!b || o.score > b.score + 1e-9 ? o : b), null);
  const latestDose = caffeineLatestFor(input.otherCaffeine ?? [], suggestedMg * FITS_SHARE, input.bedtime, h);
  const fullCaffeine = options.filter((o) => o.caffeine.fits);
  return {
    options,
    perWindow: perWindowOptions.map(pick),
    best: pick(options),
    latestStartForFullCaffeine: fullCaffeine.length ? Math.max(...fullCaffeine.map((o) => o.start)) : latestDose != null ? latestDose + lead : null,
  };
}

/** "HH:MM-HH:MM" ranges ↔ minutes. */
export const parseWindow = (w: { from: string; to: string }): TimeWindow => ({ from: hm(w.from), to: hm(w.to) });
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
