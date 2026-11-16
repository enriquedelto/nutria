import { describe, expect, it } from "vitest";
import { checkinProposal, recoverySignal, targetRate, type CheckinInput } from "../src";

const base: CheckinInput = {
  phase: "bulk",
  weightKg: 75,
  rateKgWeek: 0.2,
  observedRateKgWeek: 0.2,
  confidence: 0.8,
  loggedDays: 24,
  weekLoggedDays: 6,
  weekWeighIns: 4,
  adherence: "all",
  pace: "keep",
  previousVerdict: null,
};

describe("check-in semanal", () => {
  it.each<[string, Partial<CheckinInput>, string, number]>([
    ["en el ritmo", {}, "on_track", 0],
    ["sube despacio la primera semana: avisa, no cambia", { observedRateKgWeek: 0 }, "more", 0],
    ["sube despacio dos semanas: propone subir (máx. +150)", { observedRateKgWeek: 0, previousVerdict: "more" }, "more", 150],
    ["sube deprisa en volumen: baja ya, sin esperar", { observedRateKgWeek: 0.6 }, "less", -150],
    ["solo algunas comidas: no se cambian las kcal", { observedRateKgWeek: 0, previousVerdict: "more", adherence: "some" }, "hold", 0],
    ["sin pesajes esta semana", { weekWeighIns: 0 }, "no_data", 0],
    ["pocos días registrados esta semana", { weekLoggedDays: 3 }, "no_data", 0],
    ["no registró pero cumplió: decide el peso aunque falten días", { adherence: "untracked", weekLoggedDays: 0, confidence: 0.2, loggedDays: 5, observedRateKgWeek: 0, previousVerdict: "more" }, "more", 150],
    ["pocas semanas de datos", { loggedDays: 8, confidence: 0.3 }, "no_data", 0],
    ["definición: baja demasiado rápido → más kcal ya", { phase: "cut", rateKgWeek: -0.4, observedRateKgWeek: -1 }, "more", 150],
    ["definición: no baja dos semanas → menos kcal", { phase: "cut", rateKgWeek: -0.4, observedRateKgWeek: 0, previousVerdict: "less" }, "less", -150],
    ["mantenimiento estable", { phase: "maintain", rateKgWeek: 0, observedRateKgWeek: 0.05 }, "on_track", 0],
    ["muy por debajo del ritmo: tope de 150", { observedRateKgWeek: 0.08, rateKgWeek: 0.3, previousVerdict: "more" }, "more", 150],
  ])("%s", (_name, over, verdict, delta) => {
    const r = checkinProposal({ ...base, ...over });
    expect(r.verdict).toBe(verdict);
    expect(r.kcalDelta).toBe(delta);
    expect(Math.abs(r.kcalDelta) % 25).toBe(0);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("el ajuste es proporcional y gradual", () => {
    // 0,12 kg/semana por debajo → 132 kcal → 125 (pasos de 25).
    expect(checkinProposal({ ...base, rateKgWeek: 0.2, observedRateKgWeek: 0.08, previousVerdict: "more" }).kcalDelta).toBe(125);
    // Mucho por debajo → tope de 150 a la semana, sin compensar semanas atrasadas.
    expect(checkinProposal({ ...base, rateKgWeek: 0.2, observedRateKgWeek: -0.3, previousVerdict: "more" }).kcalDelta).toBe(150);
  });

  it("acelerar y frenar mueven el ritmo un 0,1 % del peso, dentro de límites", () => {
    expect(targetRate("bulk", 75, 0.2, "faster")).toEqual({ rate: 0.28, change: 0.08 });
    expect(targetRate("bulk", 75, 0.2, "slower")).toEqual({ rate: 0.13, change: -0.07 });
    expect(targetRate("bulk", 75, 0.1, "slower").rate).toBe(0.08); // floor 0.1 %/week
    expect(targetRate("cut", 75, -0.4, "faster").rate).toBe(-0.47);
    expect(targetRate("maintain", 75, 0, "faster")).toEqual({ rate: 0, change: 0 });
    // A rate of the other sign (left over from another phase) falls back to the phase default.
    expect(targetRate("bulk", 80, -0.5, "keep").rate).toBe(0.2);
    const p = checkinProposal({ ...base, pace: "faster" });
    expect(p.paceKcal).toBe(100); // 0,08 kg/semana ≈ 88 kcal → 100
    expect(p.reasons.some((x) => x.startsWith("Nuevo ritmo"))).toBe(true);
  });
});

describe("señal de recuperación", () => {
  const today = "2026-11-16";
  const day = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  const weeks = (perWeek: number, vol: number, lastWeekVol = vol) =>
    Array.from({ length: 28 }, (_, n) => n).flatMap((n) => (n % Math.round(7 / perWeek) === 0 ? [{ date: day(n), volumeKg: n < 7 ? lastWeekVol : vol }] : []));

  it("sin datos", () => {
    expect(recoverySignal({ today, workouts: [] }).level).toBe("unknown");
  });
  it("carga normal solo con entrenos", () => {
    const r = recoverySignal({ today, workouts: weeks(3, 5000) });
    expect(r.level).toBe("normal");
    expect(r.sources).toEqual(["entrenos"]);
  });
  it("semana mucho más cargada", () => {
    expect(recoverySignal({ today, workouts: weeks(3, 5000, 12000) }).level).toBe("loaded");
  });
  it("semana floja y sin otras señales: descansado", () => {
    expect(recoverySignal({ today, workouts: weeks(3, 5000, 1000) }).level).toBe("fresh");
  });
  it("pulso alto o poco sueño cargan aunque el entreno sea normal", () => {
    const restingHr = Array.from({ length: 28 }, (_, n) => ({ date: day(n), bpm: n < 7 ? 62 : 55 }));
    const r = recoverySignal({ today, workouts: weeks(3, 5000), restingHr });
    expect(r.level).toBe("loaded");
    expect(r.sources).toContain("pulso");
    const sleep = Array.from({ length: 5 }, (_, n) => ({ date: day(n), hours: 5.5 }));
    expect(recoverySignal({ today, workouts: weeks(3, 5000), sleep }).level).toBe("loaded");
  });
});
