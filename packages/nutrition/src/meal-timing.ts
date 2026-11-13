/**
 * Meals around training: how the pre-workout meal and the post-workout protein landed on a day,
 * and — from the history — which pre-workout timing goes with the person's best sessions.
 *
 * Guidelines (same as `trainingTiming`): a carb-rich meal 1–3 h before (~1 g/kg of carbs), and
 * 0.3–0.4 g/kg of protein within ~2 h after. Post-workout timing matters little when daily protein is
 * met (Schoenfeld, Aragon & Krieger 2013, doi:10.1186/1550-2783-10-53), so only the pre-workout meal
 * is optimised from personal data.
 *
 * Times are minutes on any common scale (minutes from 00:00 of a day, or minutes since the epoch).
 */
import { e1rm, type TrainingExercise } from "./training";

export interface TimedMeal {
  at: number;
  carbs: number;
  protein: number;
  kcal: number;
  /** Time is the meal's usual one, not the real one. */
  approx?: boolean;
}

/** A meal counts as "the pre-workout meal" from this many grams of carbs. */
export const PRE_MEAL_MIN_CARBS_G = 20;
const H = 60;

export type PreVerdict = "ok" | "too_close" | "too_early" | "low_carbs" | "none";
export type PostVerdict = "ok" | "low_protein" | "late" | "none";

export interface MealTimingDay {
  pre: { gapMin: number | null; carbsG: number; carbsTargetG: number; approx: boolean; verdict: PreVerdict };
  post: { delayMin: number | null; proteinG: number; proteinTargetG: [number, number]; approx: boolean; verdict: PostVerdict };
}

export function trainingMealTiming(meals: TimedMeal[], session: { start: number; end: number }, weightKg: number): MealTimingDay {
  const before = meals.filter((m) => m.at <= session.start).sort((a, b) => b.at - a.at);
  const last = before.find((m) => m.carbs >= PRE_MEAL_MIN_CARBS_G) ?? null;
  const carbsG = before.filter((m) => session.start - m.at <= 4 * H).reduce((s, m) => s + m.carbs, 0);
  const carbsTargetG = Math.round(weightKg);
  const gapMin = last ? session.start - last.at : null;
  const pre: PreVerdict =
    gapMin == null ? "none" : gapMin < H ? "too_close" : gapMin > 3 * H ? "too_early" : carbsG < 0.5 * weightKg ? "low_carbs" : "ok";

  const after = meals.filter((m) => m.at >= session.end && m.at - session.end <= 4 * H).sort((a, b) => a.at - b.at);
  const within2h = after.filter((m) => m.at - session.end <= 2 * H);
  const proteinG = within2h.reduce((s, m) => s + m.protein, 0);
  const proteinTargetG: [number, number] = [Math.round(0.3 * weightKg), Math.round(0.4 * weightKg)];
  const first = after[0] ?? null;
  const post: PostVerdict = !first ? "none" : proteinG >= proteinTargetG[0] ? "ok" : within2h.length ? "low_protein" : "late";

  return {
    pre: { gapMin, carbsG: Math.round(carbsG), carbsTargetG, approx: !!last?.approx, verdict: pre },
    post: { delayMin: first ? first.at - session.end : null, proteinG: Math.round(proteinG), proteinTargetG, approx: !!first?.approx, verdict: post },
  };
}

export interface TimedEntry extends TimedMeal {
  name: string;
  slot: string;
}

export interface GroupedMeal extends TimedMeal {
  slot: string;
  names: string[];
}

/**
 * Entries → meals: entries of the same meal slot less than `gapMin` apart are one meal (at its first
 * entry's time). A meal's time is approximate only if all its entries' times are.
 */
export function groupMeals(entries: TimedEntry[], gapMin = 45): GroupedMeal[] {
  const out: (GroupedMeal & { last: number })[] = [];
  for (const e of [...entries].sort((a, b) => a.at - b.at)) {
    const m = out.findLast((x) => x.slot === e.slot && e.at - x.last <= gapMin);
    if (m) {
      m.carbs += e.carbs;
      m.protein += e.protein;
      m.kcal += e.kcal;
      m.names.push(e.name);
      m.last = e.at;
      m.approx = m.approx && !!e.approx;
    } else out.push({ at: e.at, carbs: e.carbs, protein: e.protein, kcal: e.kcal, approx: !!e.approx, slot: e.slot, names: [e.name], last: e.at });
  }
  return out.map(({ last: _last, ...m }) => m);
}

/* ------------------------------- history -------------------------------- */

export interface SessionInput {
  /** Minutes (same scale as the meals). */
  start: number;
  durationMin: number;
  exercises: TrainingExercise[];
}

/**
 * Performance of each session: per exercise, its best e1RM over the median best e1RM of that exercise
 * in the previous 8 weeks (×100), averaged over the exercises with at least 2 earlier sessions.
 * Sessions must come oldest first; null = no baseline yet.
 */
export function sessionPerformance(sessions: SessionInput[]): (number | null)[] {
  const history = new Map<string, { at: number; top: number }[]>();
  return sessions.map((s) => {
    const ratios: number[] = [];
    for (const ex of s.exercises) {
      const top = Math.max(0, ...ex.sets.map((x) => e1rm(x) ?? 0));
      if (!top) continue;
      const key = ex.id || ex.name;
      const past = (history.get(key) ?? []).filter((p) => s.start - p.at <= 56 * 24 * H);
      if (past.length >= 2) ratios.push((top / median(past.map((p) => p.top))) * 100);
      history.set(key, [...past, { at: s.start, top }]);
    }
    return ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
  });
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export const GAP_BUCKETS = [
  { key: "lt1", label: "< 1 h", lo: 0, hi: 1 },
  { key: "1to2", label: "1–2 h", lo: 1, hi: 2 },
  { key: "2to3", label: "2–3 h", lo: 2, hi: 3 },
  { key: "3to4", label: "3–4 h", lo: 3, hi: 4 },
  { key: "gt4", label: "> 4 h", lo: 4, hi: Infinity },
] as const;

export const CARB_BUCKETS = [
  { key: "lt05", label: "< 0,5 g/kg", lo: 0, hi: 0.5 },
  { key: "05to1", label: "0,5–1 g/kg", lo: 0.5, hi: 1 },
  { key: "gt1", label: "> 1 g/kg", lo: 1, hi: Infinity },
] as const;

/** Sessions needed (with known meal times) before naming a "best" bucket. */
export const MIN_SESSIONS_FOR_BEST = 8;
/** …and in the winning bucket. */
export const MIN_IN_BEST_BUCKET = 3;
/** Points of performance the best bucket must beat the rest by (session-to-session noise is ~2 %). */
export const BEST_MARGIN = 2;

export interface BucketStat {
  key: string;
  label: string;
  n: number;
  /** Mean performance (100 = usual), null when empty. */
  avg: number | null;
}

export interface PrePostAnalysis {
  /** Sessions with a performance baseline and meal times known that day. */
  sessions: number;
  gap: BucketStat[];
  carbs: BucketStat[];
  bestGap: BucketStat | null;
  bestCarbs: BucketStat | null;
  post: { sessions: number; withProtein: number };
}

/**
 * `meals` must have real times (approximate ones are dropped). A session counts when some meal was
 * logged in the 12 h before it — otherwise "nothing before" may just be "nothing logged".
 */
export function prePostAnalysis(sessions: SessionInput[], meals: TimedMeal[], weightKg: number): PrePostAnalysis {
  const real = meals.filter((m) => !m.approx);
  const sorted = [...sessions].sort((a, b) => a.start - b.start);
  const perf = sessionPerformance(sorted);
  const rows: { perf: number; gapH: number; carbsPerKg: number }[] = [];
  let postSessions = 0;
  let withProtein = 0;
  sorted.forEach((s, i) => {
    const end = s.start + Math.max(20, s.durationMin);
    const t = trainingMealTiming(real, { start: s.start, end }, weightKg);
    if (t.post.verdict !== "none") {
      postSessions++;
      if (t.post.verdict === "ok") withProtein++;
    }
    const p = perf[i];
    const logged = real.some((m) => m.at <= s.start && s.start - m.at <= 12 * H);
    if (p == null || !logged) return;
    // No carb meal at all in the 12 h before counts as "more than 4 h".
    rows.push({ perf: p, gapH: t.pre.gapMin != null ? t.pre.gapMin / H : 12, carbsPerKg: t.pre.carbsG / weightKg });
  });

  const stats = (buckets: readonly { key: string; label: string; lo: number; hi: number }[], value: (r: (typeof rows)[number]) => number): BucketStat[] =>
    buckets.map((b) => {
      const xs = rows.filter((r) => value(r) >= b.lo && value(r) < b.hi).map((r) => r.perf);
      return { key: b.key, label: b.label, n: xs.length, avg: xs.length ? Math.round((xs.reduce((a, c) => a + c, 0) / xs.length) * 10) / 10 : null };
    });
  const best = (st: BucketStat[]) => {
    if (rows.length < MIN_SESSIONS_FOR_BEST) return null;
    const cand = st.filter((b) => b.n >= MIN_IN_BEST_BUCKET && b.avg != null).sort((a, b) => b.avg! - a.avg!)[0];
    if (!cand) return null;
    const rest = st.filter((b) => b.key !== cand.key && b.n);
    const restN = rest.reduce((s, b) => s + b.n, 0);
    if (!restN) return null;
    const restAvg = rest.reduce((s, b) => s + b.avg! * b.n, 0) / restN;
    return cand.avg! - restAvg > BEST_MARGIN ? cand : null;
  };
  const gap = stats(GAP_BUCKETS, (r) => r.gapH);
  const carbs = stats(CARB_BUCKETS, (r) => r.carbsPerKg);
  return { sessions: rows.length, gap, carbs, bestGap: best(gap), bestCarbs: best(carbs), post: { sessions: postSessions, withProtein } };
}
