import { addDays, weekStart } from "@nutria/nutrition";

export type TrainingSet = { kg: number | null; reps: number | null; sec?: number; warmup?: boolean };
export type TrainingExercise = { id: string; name: string; sets: TrainingSet[] };
export type TrainingLog = { date: string; volumeKg: number | null; details: Record<string, unknown> };

export function workoutExercises(details: Record<string, unknown>): TrainingExercise[] {
  return Array.isArray(details.exercises) ? (details.exercises as TrainingExercise[]).filter((e) => e && typeof e.name === "string" && Array.isArray(e.sets)) : [];
}

/** Estimated one-rep max (Epley). Only sets of 1–12 reps with weight give a meaningful estimate. */
export function e1rm(s: TrainingSet): number | null {
  if (s.warmup || !s.kg || !s.reps || s.reps < 1 || s.reps > 12) return null;
  return s.reps === 1 ? s.kg : s.kg * (1 + s.reps / 30);
}

export interface LiftProgress {
  id: string;
  name: string;
  sessions: number;
  best: { kg: number; reps: number; e1rm: number; date: string };
  /** Best e1RM per session, oldest first (last 12 sessions). */
  trend: number[];
  /** Change of the e1RM over the last ~3 months (latest session vs. best session 3+ months ago), in kg. */
  change: number | null;
  lastDate: string;
}

/**
 * Weekly sessions/volume for the last `weeks` weeks and the progress of the most trained lifts.
 * `logs` can come in any order; exercises are matched by their openGym id.
 */
export function trainingProgress(logs: TrainingLog[], today: string, weeks = 26, topN = 5) {
  const first = weekStart(addDays(today, -(weeks - 1) * 7));
  const weekKeys = Array.from({ length: weeks }, (_, i) => addDays(first, i * 7));
  const byWeek = new Map(weekKeys.map((w) => [w, { sessions: 0, volumeKg: 0 }]));
  for (const l of logs) {
    const w = byWeek.get(weekStart(l.date));
    if (!w) continue;
    w.sessions++;
    w.volumeKg += l.volumeKg ?? 0;
  }
  const weekly = weekKeys.map((date) => ({ date, ...byWeek.get(date)! }));

  const lifts = new Map<string, { name: string; points: { date: string; e1rm: number; kg: number; reps: number }[] }>();
  for (const l of [...logs].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const ex of workoutExercises(l.details)) {
      let top: { e1rm: number; kg: number; reps: number } | null = null;
      for (const s of ex.sets) {
        const v = e1rm(s);
        if (v != null && (!top || v > top.e1rm)) top = { e1rm: v, kg: s.kg!, reps: s.reps! };
      }
      if (!top) continue;
      const cur = lifts.get(ex.id) ?? { name: ex.name, points: [] };
      cur.name = ex.name; // latest name wins (aliases may change)
      cur.points.push({ date: l.date, ...top });
      lifts.set(ex.id, cur);
    }
  }
  const threeMonthsAgo = addDays(today, -90);
  const top: LiftProgress[] = [...lifts.entries()]
    .filter(([, v]) => v.points.length >= 2)
    .sort((a, b) => b[1].points.length - a[1].points.length || b[1].points.at(-1)!.date.localeCompare(a[1].points.at(-1)!.date))
    .slice(0, topN)
    .map(([id, v]) => {
      const best = v.points.reduce((a, p) => (p.e1rm > a.e1rm ? p : a));
      const last = v.points.at(-1)!;
      const before = v.points.filter((p) => p.date <= threeMonthsAgo);
      const ref = before.length ? before.reduce((a, p) => (p.e1rm > a.e1rm ? p : a)) : null;
      return {
        id,
        name: v.name,
        sessions: v.points.length,
        best: { kg: best.kg, reps: best.reps, e1rm: Math.round(best.e1rm * 10) / 10, date: best.date },
        trend: v.points.slice(-12).map((p) => Math.round(p.e1rm * 10) / 10),
        change: ref && last.date > threeMonthsAgo ? Math.round((last.e1rm - ref.e1rm) * 10) / 10 : null,
        lastDate: last.date,
      };
    });
  return { weekly, lifts: top };
}
