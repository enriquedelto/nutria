import { describe, expect, it } from "vitest";
import { bodyComposition, compositionSeries, ffmiLabel, navyBodyFatPct, photoReminderDue, skinfoldBodyFatPct } from "../src";

describe("composición corporal", () => {
  it("fórmula de la Marina de EE. UU.", () => {
    // Reference values of the published metric formula.
    expect(navyBodyFatPct({ sex: "male", heightCm: 180, neckCm: 38, waistCm: 85 })).toBeCloseTo(16.1, 0);
    expect(navyBodyFatPct({ sex: "female", heightCm: 165, neckCm: 32, waistCm: 70, hipCm: 96 })).toBeCloseTo(25.4, 0);
    expect(navyBodyFatPct({ sex: "female", heightCm: 165, neckCm: 32, waistCm: 70 })).toBeNull();
    expect(navyBodyFatPct({ sex: "male", heightCm: 180, neckCm: 40, waistCm: 39 })).toBeNull();
  });

  it("masa magra, masa grasa y FFMI", () => {
    const c = bodyComposition(80, 15, 180);
    expect(c).toMatchObject({ fatKg: 12, leanKg: 68, ffmi: 21, ffmiNorm: 21 });
    expect(bodyComposition(70, 20, 170).ffmiNorm).toBeCloseTo(20, 0);
    expect(ffmiLabel(21, "male")).toBe("por encima de la media");
    expect(ffmiLabel(17, "female")).toBe("por encima de la media");
  });

  it("serie: la cinta usa el pesaje más cercano y el % medido manda", () => {
    const s = compositionSeries({
      sex: "male",
      heightCm: 180,
      weights: [
        { date: "2026-10-01", kg: 78 },
        { date: "2026-10-29", kg: 79.5 },
        { date: "2026-11-05", kg: 80, bodyFatPct: 17 },
      ],
      measures: [
        { date: "2026-10-02", site: "neck", cm: 38 },
        { date: "2026-10-02", site: "waist", cm: 84 },
        { date: "2026-10-30", site: "neck", cm: 38.5 },
        { date: "2026-10-30", site: "waist", cm: 84 },
        { date: "2026-09-01", site: "waist", cm: 85 }, // no neck, no weigh-in near
      ],
    });
    expect(s.map((p) => [p.date, p.source, p.weightKg])).toEqual([
      ["2026-10-02", "navy", 78],
      ["2026-10-30", "navy", 79.5],
      ["2026-11-05", "measured", 80],
    ]);
    expect(s[1]!.leanKg).toBeGreaterThan(s[0]!.leanKg);
    expect(compositionSeries({ sex: null, heightCm: 180, weights: [{ date: "2026-11-05", kg: 80, bodyFatPct: 17 }], measures: [] })).toHaveLength(1);
    expect(compositionSeries({ sex: "male", heightCm: null, weights: [], measures: [] })).toEqual([]);
  });

  it("fotos cada 4 semanas", () => {
    expect(photoReminderDue("2026-10-01", "2026-10-29")).toBe(true);
    expect(photoReminderDue("2026-10-01", "2026-10-30")).toBe(false);
    expect(photoReminderDue("2026-10-01", "2026-11-26")).toBe(true);
    expect(photoReminderDue(null, "2026-11-26")).toBe(false);
  });
});

describe("pliegues (Jackson-Pollock)", () => {
  it("7 pliegues en hombre: coincide con la revisión de mayo (15,1 %)", () => {
    const folds = { chest: 12, midaxillary: 10, triceps: 16, subscapular: 16, abdominal: 19, suprailiac: 12, thigh: 23 };
    expect(skinfoldBodyFatPct({ sex: "male", age: 25, folds })).toEqual({ pct: 15.1, method: "jp7", sumMm: 108 });
  });
  it("sin los 7, usa los 3 del sexo; si faltan, null", () => {
    const r = skinfoldBodyFatPct({ sex: "male", age: 27, folds: { chest: 12, abdominal: 19, thigh: 23 } });
    expect(r?.method).toBe("jp3");
    expect(r!.pct).toBeGreaterThan(10);
    expect(r!.pct).toBeLessThan(20);
    expect(skinfoldBodyFatPct({ sex: "female", age: 30, folds: { triceps: 18, suprailiac: 15, thigh: 25 } })?.method).toBe("jp3");
    expect(skinfoldBodyFatPct({ sex: "male", age: 27, folds: { triceps: 10 } })).toBeNull();
  });
  it("en la serie de composición, los pliegues ganan a la cinta el mismo día", () => {
    const s = compositionSeries({
      sex: "male",
      heightCm: 173.5,
      birthDate: "2001-01-01",
      weights: [{ date: "2026-05-02", kg: 78.9 }],
      measures: [{ date: "2026-05-02", site: "neck", cm: 40.4 }, { date: "2026-05-02", site: "waist", cm: 83.4 }],
      folds: Object.entries({ chest: 12, midaxillary: 10, triceps: 16, subscapular: 16, abdominal: 19, suprailiac: 12, thigh: 23 }).map(([site, mm]) => ({ date: "2026-05-02", site, mm })),
    });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ source: "skinfolds", bodyFatPct: 15.1, leanKg: 67 });
  });
});
