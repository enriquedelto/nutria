/**
 * Recovery signal (pure) for the weekly check-in and the coach: training load of the last week
 * against the usual one (acute:chronic ratio), plus resting heart rate and sleep when there are
 * data. It says which data it used.
 */
import { addDays } from "./tdee-adaptive";

export type RecoveryLevel = "fresh" | "normal" | "loaded" | "unknown";

export interface RecoveryInput {
  today: string;
  /** Workouts of the last 28+ days (volume in kg; sessions without volume count as sessions). */
  workouts: { date: string; volumeKg: number | null }[];
  restingHr?: { date: string; bpm: number }[];
  sleep?: { date: string; hours: number }[];
}

export interface RecoverySignal {
  level: RecoveryLevel;
  /** Last 7 days vs. weekly average of the last 28 (1 = as usual). */
  loadRatio: number | null;
  reasons: string[];
  /** What it was based on: "entrenos", "pulso", "sueño". */
  sources: string[];
}

export const RECOVERY_LABEL: Record<RecoveryLevel, string> = { fresh: "Descansado", normal: "Normal", loaded: "Cargado", unknown: "Sin datos" };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function recoverySignal(i: RecoveryInput): RecoverySignal {
  const reasons: string[] = [];
  const sources: string[] = [];
  const last = (days: number) => addDays(i.today, -days);
  const inRange = (d: string, from: string) => d > from && d <= i.today;

  // Load: volume when the workouts have it, else the number of sessions.
  const month = i.workouts.filter((w) => inRange(w.date, last(28)));
  const week = month.filter((w) => inRange(w.date, last(7)));
  let loadRatio: number | null = null;
  if (month.length >= 4) {
    const useVolume = month.filter((w) => (w.volumeKg ?? 0) > 0).length >= month.length * 0.7;
    const load = (xs: typeof month) => (useVolume ? xs.reduce((s, w) => s + (w.volumeKg ?? 0), 0) : xs.length);
    const chronic = load(month) / 4;
    if (chronic > 0) {
      loadRatio = Math.round((load(week) / chronic) * 100) / 100;
      sources.push("entrenos");
      if (loadRatio > 1.3) reasons.push(`Esta semana has entrenado bastante más de lo habitual (${Math.round(loadRatio * 100)} %).`);
      else if (loadRatio < 0.6) reasons.push(`Esta semana has entrenado menos de lo habitual (${Math.round(loadRatio * 100)} %).`);
    }
  }

  let hrUp = false;
  const hr = i.restingHr ?? [];
  const hrWeek = avg(hr.filter((h) => inRange(h.date, last(7))).map((h) => h.bpm));
  const hrMonth = avg(hr.filter((h) => inRange(h.date, last(28))).map((h) => h.bpm));
  if (hrWeek != null && hrMonth != null && hr.filter((h) => inRange(h.date, last(28))).length >= 7) {
    sources.push("pulso");
    if (hrWeek - hrMonth >= 5) {
      hrUp = true;
      reasons.push(`El pulso en reposo va ${Math.round(hrWeek - hrMonth)} ppm por encima de lo normal.`);
    }
  }

  let sleepShort = false;
  const sl = (i.sleep ?? []).filter((s) => inRange(s.date, last(7)));
  if (sl.length >= 3) {
    sources.push("sueño");
    const h = avg(sl.map((s) => s.hours))!;
    if (h < 6.5) {
      sleepShort = true;
      reasons.push(`Duermes poco esta semana (${h.toLocaleString("es-ES", { maximumFractionDigits: 1 })} h de media).`);
    }
  }

  if (!sources.length) return { level: "unknown", loadRatio, reasons: ["Sin entrenos, pulso ni sueño suficientes para valorar la recuperación."], sources };
  const flags = [loadRatio != null && loadRatio > 1.3, hrUp, sleepShort].filter(Boolean).length;
  const level: RecoveryLevel = flags >= 1 ? "loaded" : loadRatio != null && loadRatio < 0.8 && !hrUp && !sleepShort ? "fresh" : "normal";
  if (level === "normal" && !reasons.length) reasons.push("Carga de entreno y recuperación dentro de lo normal.");
  return { level, loadRatio, reasons, sources };
}
