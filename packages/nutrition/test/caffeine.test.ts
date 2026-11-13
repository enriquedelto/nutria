import { describe, expect, it } from "vitest";
import {
  caffeineAt,
  caffeineCurve,
  caffeineFraction,
  caffeineLatestFor,
  caffeineMaxForSleep,
  caffeinePeakDelayMin,
  caffeinePlan,
  CAFFEINE_SLEEP_MAX_MG,
  clockToMinutes,
  minutesToClock,
  novaCoverage,
  dailyQualityScore,
  upfKcalPct,
  countsForAverages,
  dayLogStatus,
} from "../src";

describe("cafeína en el cuerpo", () => {
  it("pico hacia los 45 min y mitad tras una vida media", () => {
    expect(caffeinePeakDelayMin(5)).toBeGreaterThan(40);
    expect(caffeinePeakDelayMin(5)).toBeLessThan(50);
    expect(caffeineFraction(0)).toBe(0);
    expect(caffeineFraction(-1)).toBe(0);
    expect(caffeineFraction(5, 5)).toBeCloseTo(0.51, 2);
    expect(caffeineFraction(10, 5)).toBeCloseTo(0.26, 2);
  });
  it("coincide con Gardiner 2023: ~30–35 mg al acostarse", () => {
    expect(107 * caffeineFraction(8.8)).toBeGreaterThan(28);
    expect(107 * caffeineFraction(8.8)).toBeLessThan(36);
    expect(217 * caffeineFraction(13.2)).toBeGreaterThan(30);
    expect(217 * caffeineFraction(13.2)).toBeLessThan(38);
  });
  it("suma tomas y dibuja la curva", () => {
    const doses = [{ at: 480, mg: 100 }, { at: 1020, mg: 200 }];
    expect(caffeineAt(doses, 470)).toBe(0);
    expect(caffeineAt(doses, 1020 + 45)).toBeGreaterThan(200);
    const c = caffeineCurve(doses, { from: 360, to: 1920, stepMin: 30 });
    expect(c[0]).toEqual({ t: 360, mg: 0 });
    expect(c.at(-1)!.t).toBe(1920);
  });
  it("dosis máxima y hora límite para no afectar al sueño", () => {
    const bed = 1470; // 00:30
    const max = caffeineMaxForSleep([], 1035, bed); // 17:15
    expect(max).toBeGreaterThan(75);
    expect(max).toBeLessThan(85);
    const latest = caffeineLatestFor([], 200, bed)!;
    expect(200 * caffeineFraction((bed - latest) / 60)).toBeCloseTo(CAFFEINE_SLEEP_MAX_MG, 1);
    expect(caffeineLatestFor([], 20, bed)).toBe(bed);
    expect(caffeineLatestFor([{ at: 1400, mg: 300 }], 50, bed)).toBeNull();
  });
  it("plan: pico al empezar a entrenar, 3 mg/kg dentro de 400 mg/día", () => {
    const p = caffeinePlan({ doses: [{ at: 480, mg: 150 }], trainingStart: 1080, bedtime: 1470, weightKg: 78 });
    expect(p.idealAt).toBe(1080 - 45);
    expect(p.suggestedMg).toBe(230);
    expect(p.takenMg).toBe(150);
    expect(caffeinePlan({ doses: [{ at: 480, mg: 300 }], trainingStart: null, bedtime: 1470, weightKg: 78 }).suggestedMg).toBe(100);
  });
  it("horas", () => {
    expect(clockToMinutes("17:15")).toBe(1035);
    expect(minutesToClock(1470)).toBe("00:30");
    expect(minutesToClock(-30)).toBe("23:30");
  });
});

describe("cobertura NOVA", () => {
  const partial = [
    { kcal: 600, nova: 4, nutriscore: "c" },
    { kcal: 200, nova: 1, nutriscore: "a" },
    { kcal: 1200, nova: null },
  ];
  it("porcentaje de kcal con NOVA conocido", () => {
    expect(novaCoverage(partial)).toBe(40);
    expect(novaCoverage([])).toBeNull();
    expect(upfKcalPct(partial)).toBe(75);
  });
  it("sin cobertura suficiente no penaliza por ultraprocesados", () => {
    const totals = { energy_kcal: 2000, fiber: 24 };
    const withPartial = dailyQualityScore(partial, totals, { kcal: 2000 })!;
    const full = dailyQualityScore(partial.map((e) => ({ ...e, nova: e.nova ?? 4 })), totals, { kcal: 2000 })!;
    expect(withPartial).toBeGreaterThan(full);
  });
});

describe("estado del día", () => {
  it("vacío, marcado, dudoso y normal", () => {
    expect(dayLogStatus({ kcal: 0, entries: 0 }, 2400)).toBe("empty");
    expect(dayLogStatus({ kcal: 430, entries: 3 }, 2400)).toBe("suspect");
    expect(dayLogStatus({ kcal: 430, entries: 3, complete: true }, 2400)).toBe("complete");
    expect(dayLogStatus({ kcal: 2300, entries: 9, incomplete: true }, 2400)).toBe("incomplete");
    expect(dayLogStatus({ kcal: 1600, entries: 9 }, 2400)).toBe("normal");
    expect(dayLogStatus({ kcal: 430, entries: 3 }, null)).toBe("normal");
    expect(["complete", "normal", "incomplete", "suspect", "empty"].map((s) => countsForAverages(s as never))).toEqual([true, true, false, false, false]);
  });
});
