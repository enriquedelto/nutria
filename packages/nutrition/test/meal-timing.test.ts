import { describe, expect, it } from "vitest";
import { groupMeals, MIN_SESSIONS_FOR_BEST, prePostAnalysis, sessionPerformance, trainingMealTiming, type SessionInput, type TimedMeal } from "../src";

const at = (hhmm: string, day = 0) => day * 1440 + Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const meal = (hhmm: string, carbs: number, protein: number, day = 0, approx = false): TimedMeal => ({ at: at(hhmm, day), carbs, protein, kcal: carbs * 4 + protein * 4, approx });

describe("comida antes y después de entrenar (día)", () => {
  const session = { start: at("18:00"), end: at("19:10") };
  it("previa a 2 h con hidratos suficientes y proteína dentro de 2 h", () => {
    const t = trainingMealTiming([meal("08:00", 60, 20), meal("16:00", 75, 25), meal("19:45", 50, 35)], session, 78);
    expect(t.pre).toMatchObject({ gapMin: 120, carbsG: 75, carbsTargetG: 78, verdict: "ok" });
    expect(t.post).toMatchObject({ delayMin: 35, proteinG: 35, proteinTargetG: [23, 31], verdict: "ok" });
  });
  it("demasiado cerca, demasiado pronto, pocos hidratos y sin comida después", () => {
    expect(trainingMealTiming([meal("17:30", 60, 10)], session, 78).pre.verdict).toBe("too_close");
    expect(trainingMealTiming([meal("13:00", 90, 30)], session, 78).pre.verdict).toBe("too_early");
    expect(trainingMealTiming([meal("16:00", 25, 10)], session, 78).pre.verdict).toBe("low_carbs");
    expect(trainingMealTiming([meal("16:00", 5, 10)], session, 78).pre.verdict).toBe("none"); // nothing with ≥ 20 g carbs
    const t = trainingMealTiming([meal("16:00", 80, 20)], session, 78);
    expect(t.post.verdict).toBe("none");
    expect(trainingMealTiming([meal("22:00", 40, 40)], session, 78).post.verdict).toBe("late");
    expect(trainingMealTiming([meal("19:30", 40, 10)], session, 78).post.verdict).toBe("low_protein");
  });
  it("marca la hora aproximada (hora habitual de la comida)", () => {
    expect(trainingMealTiming([meal("16:00", 75, 25, 0, true)], session, 78).pre.approx).toBe(true);
  });
});

/** A session every 3 days with one press; strength depends on the pre-workout gap. */
function history(n: number, gapFor: (i: number) => number) {
  const sessions: SessionInput[] = [];
  const meals: TimedMeal[] = [];
  for (let i = 0; i < n; i++) {
    const day = i * 3;
    const gap = gapFor(i);
    // ~2 h before → +5 % strength; otherwise baseline (small alternating noise).
    const kg = 100 * (gap >= 1.5 && gap < 2.5 ? 1.05 : 1) * (i % 2 ? 1.005 : 0.995);
    sessions.push({ start: at("18:00", day), durationMin: 60, exercises: [{ id: "bench", name: "Press banca", sets: [{ kg, reps: 5 }] }] });
    meals.push({ at: at("18:00", day) - gap * 60, carbs: 80, protein: 25, kcal: 500 });
    meals.push({ at: at("19:30", day), carbs: 60, protein: i % 3 ? 35 : 10, kcal: 500 });
  }
  return { sessions, meals };
}

describe("mejor momento personal (historial)", () => {
  it("rendimiento relativo a la mediana de las 8 semanas previas", () => {
    const s = (kg: number, day: number): SessionInput => ({ start: at("18:00", day), durationMin: 60, exercises: [{ id: "b", name: "B", sets: [{ kg, reps: 5 }, { kg: 20, reps: 15, warmup: true }] }] });
    const p = sessionPerformance([s(100, 0), s(100, 3), s(110, 6), s(100, 100)]);
    expect(p[0]).toBeNull();
    expect(p[1]).toBeNull();
    expect(p[2]).toBeCloseTo(110, 5);
    expect(p[3]).toBeNull(); // the earlier sessions are more than 8 weeks back
  });
  it("con pocas sesiones no da «mejor momento»", () => {
    const { sessions, meals } = history(6, (i) => (i % 2 ? 2 : 4.5));
    const r = prePostAnalysis(sessions, meals, 78);
    expect(r.sessions).toBeLessThan(MIN_SESSIONS_FOR_BEST);
    expect(r.bestGap).toBeNull();
  });
  it("encuentra la ventana que acompaña a las mejores sesiones", () => {
    const { sessions, meals } = history(20, (i) => [1.5, 4.5, 0.5, 3.5][i % 4]!);
    const r = prePostAnalysis(sessions, meals, 78);
    expect(r.sessions).toBeGreaterThanOrEqual(MIN_SESSIONS_FOR_BEST);
    expect(r.bestGap?.key).toBe("1to2");
    expect(r.gap.find((b) => b.key === "1to2")!.n).toBeGreaterThanOrEqual(3);
    expect(r.post.sessions).toBe(20);
    expect(r.post.withProtein).toBe(13); // protein ≥ 0.3 g/kg in 2 of every 3 sessions
  });
  it("ignora horas aproximadas y sesiones sin comidas registradas antes", () => {
    const { sessions, meals } = history(12, () => 2);
    const r = prePostAnalysis(sessions, meals.map((m) => ({ ...m, approx: true })), 78);
    expect(r.sessions).toBe(0);
  });
});

describe("agrupar entradas en comidas", () => {
  it("misma comida y cerca en el tiempo → una; si no, separadas", () => {
    const e = (hhmm: string, slot: string, carbs: number, approx = false) => ({ at: at(hhmm), slot, carbs, protein: 5, kcal: 100, name: `${slot}@${hhmm}`, approx });
    const g = groupMeals([e("14:00", "lunch", 30), e("14:20", "lunch", 25), e("17:30", "snack", 15, true), e("15:30", "lunch", 10)]);
    expect(g.map((m) => [m.slot, m.at, m.carbs, m.approx])).toEqual([
      ["lunch", at("14:00"), 55, false],
      ["lunch", at("15:30"), 10, false],
      ["snack", at("17:30"), 15, true],
    ]);
  });
});
