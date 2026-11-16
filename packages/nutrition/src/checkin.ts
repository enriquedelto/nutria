/**
 * Weekly check-in (pure): from the trend-weight rate, the logging of the week and the person's
 * answers, propose keeping or changing the daily kcal. Changes are gradual (25-kcal steps, at most
 * ±150 a week), late weeks are not compensated, and a week logged by halves changes nothing.
 */
import { KCAL_PER_KG } from "./targets";

export type DietPhase = "bulk" | "maintain" | "cut";
/** «Lo registré todo» / «Solo algunas comidas» / «No registré, pero cumplí». */
export type Adherence = "all" | "some" | "untracked";
/** «Acelerar» / «Mantener ritmo» / «Frenar». */
export type Pace = "faster" | "keep" | "slower";
/** more = needs more kcal, less = needs fewer. */
export type CheckinVerdict = "no_data" | "hold" | "on_track" | "more" | "less";

export const PHASE_LABEL: Record<DietPhase, string> = { bulk: "Volumen", maintain: "Mantenimiento", cut: "Definición" };
export const DEFAULT_RATE_PCT: Record<DietPhase, number> = { bulk: 0.25, maintain: 0, cut: -0.5 };
/** One «Acelerar» / «Frenar» moves the rate this much (% of body weight a week). */
export const PACE_STEP_PCT = 0.1;
export const MAX_WEEKLY_CHANGE = 150;

export const phaseOfGoal = (goal: "lose" | "maintain" | "gain"): DietPhase => (goal === "gain" ? "bulk" : goal === "lose" ? "cut" : "maintain");

export interface CheckinInput {
  phase: DietPhase;
  weightKg: number | null;
  /** Chosen rate in kg/week (positive gain, negative loss); 0 or null = the phase default. */
  rateKgWeek: number | null;
  /** Trend-weight rate of the last 28 days (adaptiveTdee). */
  observedRateKgWeek: number | null;
  confidence: number;
  /** Days with credible logging in the 28-day window. */
  loggedDays: number;
  /** Days of the last week that count (after excluding partial ones). */
  weekLoggedDays: number;
  weekWeighIns: number;
  adherence: Adherence;
  pace: Pace;
  /** Verdict of last week's check-in: a change needs the same one two weeks running. */
  previousVerdict?: CheckinVerdict | null;
}

export interface CheckinProposal {
  verdict: CheckinVerdict;
  /** Target rate after the pace answer, kg/week. */
  targetRateKgWeek: number;
  /** Change of the target rate from «Acelerar» / «Frenar», kg/week (0 = same). */
  rateChangeKgWeek: number;
  /** Daily kcal the pace change means on its own. */
  paceKcal: number;
  /** Daily kcal change from the weight trend (0 = keep). */
  kcalDelta: number;
  reasons: string[];
}

const round25 = (n: number) => Math.round(n / 25) * 25;
const fmtRate = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("es-ES", { maximumFractionDigits: 2 })} kg/semana`;

/** Rate the person aims at, with the pace answer applied (never crossing to the other phase). */
export function targetRate(phase: DietPhase, weightKg: number | null, rateKgWeek: number | null, pace: Pace): { rate: number; change: number } {
  const w = weightKg ?? 70;
  const base = rateKgWeek && Math.sign(rateKgWeek) === Math.sign(DEFAULT_RATE_PCT[phase]) ? rateKgWeek : (DEFAULT_RATE_PCT[phase] / 100) * w;
  if (phase === "maintain" || pace === "keep") return { rate: round2(base), change: 0 };
  const step = (PACE_STEP_PCT / 100) * w;
  const dir = phase === "bulk" ? 1 : -1;
  const raw = base + (pace === "faster" ? dir : -dir) * step;
  // Bounds: bulk 0.1–0.75 %/week, cut 0.25–1 %/week.
  const [lo, hi] = phase === "bulk" ? [0.001 * w, 0.0075 * w] : [-0.01 * w, -0.0025 * w];
  const rate = round2(Math.min(hi, Math.max(lo, raw)));
  return { rate, change: round2(rate - round2(base)) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function checkinProposal(i: CheckinInput): CheckinProposal {
  const { rate, change } = targetRate(i.phase, i.weightKg, i.rateKgWeek, i.pace);
  const paceKcal = round25((change * KCAL_PER_KG) / 7);
  const base = { targetRateKgWeek: rate, rateChangeKgWeek: change, paceKcal };
  const reasons: string[] = [];
  if (change) reasons.push(`Nuevo ritmo: ${fmtRate(rate)} (${paceKcal > 0 ? "+" : "−"}${Math.abs(paceKcal)} kcal al día).`);

  if (i.adherence === "some") {
    reasons.unshift("Esta semana se registró solo en parte: no se cambian las calorías por el peso. Vuelve a mirarlo la semana que viene.");
    return { ...base, verdict: "hold", kcalDelta: 0, reasons };
  }
  if (!i.weekWeighIns) {
    reasons.unshift("No hay ningún pesaje esta semana: pésate al menos una vez (mejor 3–4, en ayunas) para poder decidir.");
    return { ...base, verdict: "no_data", kcalDelta: 0, reasons };
  }
  const byWeightOnly = i.adherence === "untracked";
  if (i.observedRateKgWeek == null || (!byWeightOnly && (i.confidence < 0.5 || i.loggedDays < 14 || i.weekLoggedDays < 4))) {
    reasons.unshift(
      byWeightOnly || i.loggedDays >= 14
        ? i.weekLoggedDays < 4 && !byWeightOnly
          ? `Solo ${i.weekLoggedDays} día(s) registrados de verdad esta semana: hacen falta al menos 4.`
          : "Aún no hay bastantes pesajes para ver la tendencia."
        : "Aún faltan datos: hacen falta unas 3–4 semanas con el diario casi completo y varios pesajes por semana.",
    );
    return { ...base, verdict: "no_data", kcalDelta: 0, reasons };
  }

  const obs = i.observedRateKgWeek;
  const w = i.weightKg ?? 70;
  // Inside the band = on track: half the target rate, or 0.1 % of the weight a week in maintenance.
  const band = Math.max(Math.abs(rate) * 0.5, 0.001 * w);
  const gap = rate - obs; // > 0: below the target (needs more kcal)
  if (Math.abs(gap) <= band) {
    reasons.unshift(`Vas bien: ${fmtRate(obs)} con un objetivo de ${fmtRate(rate)}${byWeightOnly ? " (decidido solo por el peso)" : ""}.`);
    return { ...base, verdict: "on_track", kcalDelta: 0, reasons };
  }
  const verdict: CheckinVerdict = gap > 0 ? "more" : "less";
  // Gaining too fast in a bulk (fat) or losing too fast in a cut (muscle) is corrected at once;
  // anything else waits for a second week in the same direction.
  const urgent = (i.phase === "bulk" && verdict === "less") || (i.phase === "cut" && verdict === "more");
  const what =
    i.phase === "bulk"
      ? verdict === "more"
        ? obs <= 0 ? `El peso no sube (${fmtRate(obs)})` : `Subes más despacio de lo previsto (${fmtRate(obs)} frente a ${fmtRate(rate)})`
        : `Subes más rápido de lo previsto (${fmtRate(obs)} frente a ${fmtRate(rate)}): parte será grasa`
      : i.phase === "cut"
        ? verdict === "less"
          ? obs >= 0 ? `El peso no baja (${fmtRate(obs)})` : `Bajas más despacio de lo previsto (${fmtRate(obs)} frente a ${fmtRate(rate)})`
          : `Bajas más rápido de lo previsto (${fmtRate(obs)} frente a ${fmtRate(rate)}): puedes perder músculo`
        : `El peso se mueve (${fmtRate(obs)}) en mantenimiento`;
  if (!urgent && i.previousVerdict !== verdict) {
    reasons.unshift(`${what}. Si la semana que viene sigue igual, se propondrá ${verdict === "more" ? "subir" : "bajar"} las calorías.`);
    return { ...base, verdict, kcalDelta: 0, reasons };
  }
  const size = Math.min(MAX_WEEKLY_CHANGE, Math.max(50, round25(Math.abs((gap * KCAL_PER_KG) / 7))));
  const kcalDelta = verdict === "more" ? size : -size;
  reasons.unshift(`${what}${urgent ? "" : " por segunda semana seguida"}. Propuesta: ${kcalDelta > 0 ? "+" : "−"}${size} kcal al día${byWeightOnly ? " (decidido solo por el peso)" : ""}.`);
  return { ...base, verdict, kcalDelta, reasons };
}
