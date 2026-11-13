import { describe, expect, it } from "vitest";
import { bestTrainingTimes, minutesToClock, parseWindow } from "../src";

const m = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
// Gym 9:30–13:30 and 17:00–22:00, 70-min sessions, up at 08:00, bed at 00:30, 78 kg.
const base = {
  windows: [parseWindow({ from: "09:30", to: "13:30" }), parseWindow({ from: "17:00", to: "22:00" })],
  durationMin: 70,
  wake: m("08:00"),
  bedtime: 24 * 60 + 30,
  weightKg: 78,
};

describe("mejor hora para entrenar", () => {
  it("por la mañana cabe la dosis completa de cafeína; por la tarde no", () => {
    const p = bestTrainingTimes(base);
    expect(p.perWindow).toHaveLength(2);
    const morning = p.perWindow[0]!;
    const evening = p.perWindow[1]!;
    expect(morning.caffeine).toMatchObject({ suggestedMg: 230, fits: true });
    expect(evening.caffeine.fits).toBe(false);
    expect(evening.caffeine.maxMg).toBeLessThan(150);
    expect(p.best!.start).toBeLessThan(m("13:30"));
    expect(p.best!.score).toBeGreaterThan(evening.score);
  });
  it("demasiado temprano no deja hueco para la comida previa", () => {
    const p = bestTrainingTimes(base);
    const first = p.options[0]!; // 09:30, up at 08:00 → eat from 08:30, only 1 h before
    expect(minutesToClock(first.start)).toBe("09:30");
    expect(first.meal.ok).toBe(false);
    const ten = p.options.find((o) => o.start === m("10:30"))!;
    expect(ten.meal).toMatchObject({ ok: true, from: m("08:30"), to: m("09:30") });
  });
  it("hora límite para la dosis completa y café de la mañana sustituido si va justo antes", () => {
    const p = bestTrainingTimes(base);
    expect(p.latestStartForFullCaffeine).not.toBeNull();
    expect(p.latestStartForFullCaffeine!).toBeLessThan(m("17:00"));
    const withCoffee = bestTrainingTimes({ ...base, otherCaffeine: [{ at: m("08:30"), mg: 150 }] });
    // 10:30 start → dose at 09:45: the 08:30 coffee is within 2 h, so it is the pre-workout dose itself.
    expect(withCoffee.options.find((o) => o.start === m("10:30"))!.caffeine.fits).toBe(true);
    // An evening session has less room with the morning coffee still counted.
    expect(withCoffee.perWindow[1]!.caffeine.maxMg).toBeLessThanOrEqual(p.perWindow[1]!.caffeine.maxMg);
  });
  it("sin tramos no hay recomendación", () => {
    expect(bestTrainingTimes({ ...base, windows: [] }).best).toBeNull();
  });
});
