import { describe, expect, it } from "vitest";
import { leanMassCheck, liftSeries, photoStatus, strengthTrend, type TrainingLog } from "../src";

const log = (date: string, kg: number, id = "bench"): TrainingLog => ({ date, volumeKg: null, details: { exercises: [{ id, name: id === "bench" ? "Press banca" : "Sentadilla", sets: [{ kg, reps: 5 }] }] } });

describe("fuerza", () => {
  it("mejor 1RM reciente (3 semanas) frente a las 9 anteriores", () => {
    const logs = [log("2026-09-01", 100), log("2026-09-20", 100), log("2026-11-01", 90), log("2026-11-10", 92)];
    const t = strengthTrend(logs, "2026-11-13");
    expect(t.lifts).toBe(1);
    expect(t.pct).toBe(-8);
    expect(strengthTrend([log("2026-11-01", 90)], "2026-11-13").pct).toBeNull();
  });
  it("series de los básicos más entrenados (≥ 3 sesiones)", () => {
    const logs = [log("2026-09-01", 100), log("2026-09-08", 102), log("2026-09-15", 104), log("2026-09-15", 90, "squat"), log("2026-09-22", 95, "squat")];
    const s = liftSeries(logs, "2026-08-01");
    expect(s).toHaveLength(1);
    expect(s[0]!.points.map((p) => p.date)).toEqual(["2026-09-01", "2026-09-08", "2026-09-15"]);
  });
});

describe("prioridad de básicos", () => {
  it("los multiarticulares van antes aunque tengan menos sesiones", () => {
    const ex = (date: string, id: string, name: string, kg: number): TrainingLog => ({ date, volumeKg: null, details: { exercises: [{ id, name, sets: [{ kg, reps: 8 }] }] } });
    const logs = [
      ...["2026-09-01", "2026-09-05", "2026-09-09", "2026-09-13", "2026-09-17"].map((d) => ex(d, "curl", "Curl con barra", 30)),
      ...["2026-09-02", "2026-09-10", "2026-09-18"].map((d) => ex(d, "squat", "Sentadilla con barra", 80)),
      ...["2026-09-03", "2026-09-11", "2026-09-19"].map((d) => ex(d, "bulg", "Sentadilla búlgara con mancuernas", 20)),
    ];
    expect(liftSeries(logs, "2026-08-01").map((s) => s.key)).toEqual(["squat", "curl", "bulg"]);
  });
});

describe("señal de pérdida de masa magra", () => {
  const base = { plannedPerWeek: 4, sessionsLast28: 15, daysSinceLast: 2, weightChangeKg: 0.4, strengthPct: 2, waistChangeCm: 0.2 };
  it("todo en orden", () => {
    expect(leanMassCheck(base).level).toBe("ok");
  });
  it("peso abajo con la cintura igual → alerta", () => {
    const r = leanMassCheck({ ...base, weightChangeKg: -1.6, waistChangeCm: 0 });
    expect(r.level).toBe("alert");
    expect(r.reasons.join(" ")).toContain("con la cintura igual");
  });
  it("pocos entrenos y menos fuerza → alerta; solo pocos entrenos → vigilar", () => {
    expect(leanMassCheck({ ...base, sessionsLast28: 5, strengthPct: -8 }).level).toBe("alert");
    const w = leanMassCheck({ ...base, sessionsLast28: 5 });
    expect(w.level).toBe("watch");
    expect(w.adherence).toBeCloseTo(0.31, 2);
  });
  it("3 semanas sin entrenar → alerta; en definición, bajar de peso no cuenta", () => {
    expect(leanMassCheck({ ...base, daysSinceLast: 23 }).level).toBe("alert");
    expect(leanMassCheck({ ...base, weightChangeKg: -2, waistChangeCm: -2, cutting: true }).level).toBe("ok");
  });
  it("peso abajo sin medir la cintura → vigilar y pedir la medida", () => {
    const r = leanMassCheck({ ...base, weightChangeKg: -1.5, waistChangeCm: null });
    expect(r.level).toBe("watch");
    expect(r.reasons.at(-1)).toContain("Mide la cintura");
  });
});

describe("fotos de progreso", () => {
  it("toca si no hay ninguna o han pasado 4 semanas; poses que faltan", () => {
    expect(photoStatus([], "2026-11-13")).toMatchObject({ due: true, last: null, missing: ["front", "side", "back"] });
    const p = photoStatus([{ date: "2026-10-10", pose: "front" }, { date: "2026-10-10", pose: "side" }], "2026-11-13");
    expect(p).toMatchObject({ due: true, daysSince: 34, missing: ["back"] });
    expect(photoStatus([{ date: "2026-11-01", pose: "front" }], "2026-11-13").due).toBe(false);
  });
});
