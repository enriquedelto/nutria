import { describe, expect, it } from "vitest";
import { bodySignal, bulkReview, setsByMuscle, setsStatus, strengthChangePct, type MuscleGroup } from "../src";

const base = { targetRateKgWeek: 0.25, confidence: 0.8, loggedDays: 24 };

describe("bulkReview", () => {
  it("sin datos fiables no propone nada", () => {
    expect(bulkReview({ ...base, observedRateKgWeek: null }).verdict).toBe("no_data");
    expect(bulkReview({ ...base, observedRateKgWeek: 0.1, confidence: 0.4 }).verdict).toBe("no_data");
    expect(bulkReview({ ...base, observedRateKgWeek: 0.1, loggedDays: 10 }).verdict).toBe("no_data");
  });

  it("lento: avisa la primera semana y propone subir la segunda (100–150 kcal)", () => {
    const first = bulkReview({ ...base, observedRateKgWeek: 0.05 });
    expect(first).toMatchObject({ verdict: "slow", kcalDelta: 0 });
    expect(first.message).toMatch(/semana que viene/);
    const second = bulkReview({ ...base, observedRateKgWeek: 0.05, previousVerdict: "slow" });
    expect(second.verdict).toBe("slow");
    expect(second.kcalDelta).toBe(150); // gap 220 kcal/día → tope 150
    expect(bulkReview({ ...base, observedRateKgWeek: 0.12, previousVerdict: "slow" }).kcalDelta).toBe(150);
    // A small gap still moves at least 100 kcal.
    expect(bulkReview({ targetRateKgWeek: 0.2, observedRateKgWeek: 0.09, confidence: 0.9, loggedDays: 28, previousVerdict: "slow" }).kcalDelta).toBe(125);
    expect(bulkReview({ ...base, observedRateKgWeek: -0.1, previousVerdict: "slow" }).message).toMatch(/no sube/);
  });

  it("rápido: propone bajar enseguida", () => {
    const r = bulkReview({ ...base, observedRateKgWeek: 0.5 });
    expect(r.verdict).toBe("fast");
    expect(r.kcalDelta).toBe(-150);
    expect(bulkReview({ ...base, targetRateKgWeek: 0.1, observedRateKgWeek: 0.2 }).kcalDelta).toBe(-100);
  });

  it("en rango: vas bien", () => {
    expect(bulkReview({ ...base, observedRateKgWeek: 0.2 })).toMatchObject({ verdict: "on_track", kcalDelta: 0, ratio: 0.8 });
    // weekly_rate 0 = not set → 0.25
    expect(bulkReview({ ...base, targetRateKgWeek: 0, observedRateKgWeek: 0.25 }).verdict).toBe("on_track");
  });
});

const log = (date: string, exercises: { id: string; sets: { kg: number | null; reps: number | null; warmup?: boolean }[] }[]) => ({ date, volumeKg: null, details: { exercises: exercises.map((e) => ({ ...e, name: e.id })) } });

describe("series por músculo y fuerza", () => {
  const muscles: Record<string, MuscleGroup[]> = { bench: ["pecho", "triceps"], squat: ["cuadriceps"], curl: ["biceps"] };
  const muscleOf = (id: string) => muscles[id] ?? [];
  const logs = [
    log("2026-11-02", [{ id: "bench", sets: [{ kg: 40, reps: 10, warmup: true }, { kg: 60, reps: 8 }, { kg: 60, reps: 8 }, { kg: 60, reps: 7 }] }, { id: "unknown", sets: [{ kg: 10, reps: 10 }] }]),
    log("2026-11-04", [{ id: "squat", sets: [{ kg: 80, reps: 5 }, { kg: 80, reps: 5 }] }, { id: "curl", sets: [{ kg: 12, reps: null }] }]),
    log("2026-10-20", [{ id: "bench", sets: [{ kg: 55, reps: 8 }] }]),
  ];

  it("cuenta series de trabajo (sin calentamiento) por músculo en el periodo", () => {
    const s = setsByMuscle(logs, muscleOf, "2026-11-02", "2026-11-08");
    expect(s.pecho).toBe(3);
    expect(s.triceps).toBe(1.5); // secondary: half a set each
    expect(s.cuadriceps).toBe(2);
    expect(s.biceps).toBe(0); // set without reps or time
    expect(setsStatus(8)).toBe("low");
    expect(setsStatus(14)).toBe("ok");
    expect(setsStatus(24)).toBe("high");
  });

  it("cambio de fuerza: mejor 1RM estimado de 2 semanas frente a las 4 anteriores", () => {
    // bench: 60×8 (76) vs 55×8 (69.67) → +9.1 %
    expect(strengthChangePct(logs, "2026-11-09")).toBeCloseTo(9.1, 1);
    expect(strengthChangePct(logs.slice(0, 2), "2026-11-09")).toBeNull();
  });
});

describe("músculos por nombre (ejercicios propios)", () => {
  it("deduce el músculo principal", async () => {
    const { musclesFromName } = await import("../src");
    expect(musclesFromName("Hip thrust")[0]).toBe("gluteos");
    expect(musclesFromName("Curl femoral tumbado")[0]).toBe("isquios");
    expect(musclesFromName("Curl martillo")[0]).toBe("biceps");
    expect(musclesFromName("Press banca inclinado")[0]).toBe("pecho");
    expect(musclesFromName("Jalón al pecho")[0]).toBe("espalda");
    expect(musclesFromName("Fondos de tríceps")[0]).toBe("triceps");
    expect(musclesFromName("Zancada en mi banco")[0]).toBe("cuadriceps");
    expect(musclesFromName("Caminar")).toEqual([]);
  });
});

describe("bodySignal", () => {
  it("peso y fuerza suben, cintura estable → músculo", () => {
    expect(bodySignal({ weightChangeKg: 0.8, strengthChangePct: 5, waistChangeCm: 0.3 }).kind).toBe("lean");
    expect(bodySignal({ weightChangeKg: 0.8, strengthChangePct: 5, waistChangeCm: null }).text).toMatch(/Mide la cintura/);
  });
  it("cintura crece sin fuerza → grasa", () => {
    expect(bodySignal({ weightChangeKg: 1.2, strengthChangePct: 0, waistChangeCm: 2 }).kind).toBe("fat");
    expect(bodySignal({ weightChangeKg: 1.2, strengthChangePct: 4, waistChangeCm: 2 }).kind).toBe("watch");
  });
  it("peso parado o sin datos", () => {
    expect(bodySignal({ weightChangeKg: 0, strengthChangePct: 3, waistChangeCm: null }).kind).toBe("stalled");
    expect(bodySignal({ weightChangeKg: null, strengthChangePct: 3, waistChangeCm: 0 }).kind).toBe("unknown");
    expect(bodySignal({ weightChangeKg: 0.5, strengthChangePct: null, waistChangeCm: 0 }).kind).toBe("watch");
  });
});
