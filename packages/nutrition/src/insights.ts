/**
 * M5 symptom correlations, streaks (M13), micro gaps for weekly reports.
 */
import { NUTRIENT_BY_CODE } from "./nutrients";
import type { MicroTarget } from "./targets";
import type { NutrientMap } from "./totals";

export interface ExposureEvent {
  at: number; // epoch ms
  key: string; // ingredient / food key / tag (e.g. "lacteos", "cebolla")
}
export interface SymptomEvent {
  at: number;
  symptom: string;
  intensity: number; // 1..5
}

export interface Correlation {
  key: string;
  symptom: string;
  exposures: number;
  withSymptom: number;
  rate: number; // P(symptom | exposure)
  baseline: number; // P(symptom in window | random window without exposure)
  lift: number;
  score: number; // lift weighted by evidence
}

/**
 * For each exposure key: fraction of exposures followed by the symptom within [minH, maxH] hours,
 * compared to the baseline rate over windows anchored on *other* meals. Requires ≥ minExposures.
 */
export function symptomCorrelations(
  exposures: ExposureEvent[],
  symptoms: SymptomEvent[],
  opts: { minH?: number; maxH?: number; minExposures?: number; minIntensity?: number } = {},
): Correlation[] {
  const minMs = (opts.minH ?? 2) * 3_600_000;
  const maxMs = (opts.maxH ?? 24) * 3_600_000;
  const minExp = opts.minExposures ?? 4;
  const sym = symptoms.filter((s) => s.intensity >= (opts.minIntensity ?? 2));
  const followed = (at: number, symptom: string) => sym.some((s) => s.symptom === symptom && s.at - at >= minMs && s.at - at <= maxMs);
  const keys = [...new Set(exposures.map((e) => e.key))];
  const symptomsSet = [...new Set(sym.map((s) => s.symptom))];
  // Distinct meal anchors (timestamps) for baseline
  const anchors = [...new Set(exposures.map((e) => e.at))];
  const out: Correlation[] = [];
  for (const symptom of symptomsSet) {
    for (const key of keys) {
      const expAt = [...new Set(exposures.filter((e) => e.key === key).map((e) => e.at))];
      if (expAt.length < minExp) continue;
      const withSymptom = expAt.filter((at) => followed(at, symptom)).length;
      const others = anchors.filter((a) => !expAt.includes(a));
      const baseHits = others.filter((at) => followed(at, symptom)).length;
      const baseline = others.length ? (baseHits + 0.5) / (others.length + 1) : 0.5;
      const rate = withSymptom / expAt.length;
      const lift = rate / baseline;
      const score = lift * Math.min(1, expAt.length / 10) * (withSymptom >= 3 ? 1 : 0.5);
      out.push({ key, symptom, exposures: expAt.length, withSymptom, rate, baseline, lift, score });
    }
  }
  return out.filter((c) => c.lift >= 1.5 && c.withSymptom >= 3).sort((a, b) => b.score - a.score);
}

/* ----------------------------------- Streaks ----------------------------------- */

/** Current and best streak of consecutive dates satisfying the predicate (dates YYYY-MM-DD). */
export function streak(datesOk: string[], today: string): { current: number; best: number; lastDate: string | null } {
  const set = new Set(datesOk);
  const sorted = [...set].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    if (prev && (Date.parse(d) - Date.parse(prev)) / 86_400_000 === 1) run++;
    else run = 1;
    best = Math.max(best, run);
    prev = d;
  }
  // current: count back from today (or yesterday if today not yet satisfied)
  let current = 0;
  let cursor = set.has(today) ? today : new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  while (set.has(cursor)) {
    current++;
    cursor = new Date(Date.parse(`${cursor}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  }
  return { current, best, lastDate: sorted.at(-1) ?? null };
}

/* ----------------------------------- Micro gaps -------------------------------- */

export interface MicroGap {
  code: string;
  nameEs: string;
  avg: number;
  target: number;
  pct: number;
  kind: "low" | "high";
}

/** Average daily intake vs. targets → lows (< threshold of target) and highs (> max). */
export function microGaps(dailyTotals: NutrientMap[], targets: Record<string, MicroTarget>, lowThreshold = 0.7): MicroGap[] {
  if (!dailyTotals.length) return [];
  const out: MicroGap[] = [];
  for (const [code, t] of Object.entries(targets)) {
    const vals = dailyTotals.map((d) => d[code]).filter((v): v is number => v != null);
    if (vals.length < Math.max(1, dailyTotals.length * 0.5)) continue; // not enough data for this nutrient
    const avg = vals.reduce((a, b) => a + b, 0) / dailyTotals.length;
    const name = NUTRIENT_BY_CODE[code]?.nameEs ?? code;
    if (t.min && avg < t.min * lowThreshold) out.push({ code, nameEs: name, avg, target: t.min, pct: avg / t.min, kind: "low" });
    if (t.max && avg > t.max) out.push({ code, nameEs: name, avg, target: t.max, pct: avg / t.max, kind: "high" });
  }
  return out.sort((a, b) => (a.kind === "low" ? a.pct : -a.pct) - (b.kind === "low" ? b.pct : -b.pct));
}

/** Progress (0..1+) of a nutrient vs target for UI bars. */
export function progress(value: number, t?: MicroTarget): { pct: number; status: "low" | "ok" | "high" | "none" } {
  if (!t || (t.min == null && t.max == null)) return { pct: 0, status: "none" };
  if (t.max != null && value > t.max) return { pct: value / t.max, status: "high" };
  if (t.min != null) return { pct: value / t.min, status: value >= t.min ? "ok" : "low" };
  return { pct: t.max ? value / t.max : 0, status: "ok" };
}
