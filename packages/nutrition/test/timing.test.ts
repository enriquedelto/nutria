import { describe, expect, it } from "vitest";
import { mealProteinStatus, medianTime, proteinDoseG, proteinGapG, timingPhase, trainingTiming } from "../src";

describe("proteína por comida y timing", () => {
  it("dosis ideal: 0,4 g/kg con mínimo 25 g", () => {
    expect(proteinDoseG(50)).toBe(25);
    expect(proteinDoseG(80)).toBe(32);
    expect(mealProteinStatus(30, 32)).toBe("ok");
    expect(mealProteinStatus(22, 32)).toBe("near");
    expect(mealProteinStatus(10, 32)).toBe("low");
  });
  it("hora habitual: mediana redondeada a 5 min", () => {
    expect(medianTime([])).toBeNull();
    expect(medianTime(["18:02", "18:31", "07:00"])).toBe("18:00");
    expect(medianTime(["18:00", "19:00"])).toBe("18:30");
  });
  it("ventanas antes y después y fase actual", () => {
    const t = trainingTiming("18:30", 75, 70);
    expect(t).toMatchObject({ preFrom: "15:30", preTo: "17:30", end: "19:45", postUntil: "21:45", postProteinG: [21, 28], preCarbsG: 70 });
    expect(timingPhase(t, "10:00")).toBe("early");
    expect(timingPhase(t, "16:00")).toBe("pre");
    expect(timingPhase(t, "18:00")).toBe("soon");
    expect(timingPhase(t, "19:00")).toBe("during");
    expect(timingPhase(t, "20:30")).toBe("post");
    expect(timingPhase(t, "22:30")).toBe("late");
  });
  it("aviso de proteína solo si faltan 20 g o más", () => {
    expect(proteinGapG(140, 100)).toBe(40);
    expect(proteinGapG(140, 125)).toBe(0);
    expect(proteinGapG(140, 160)).toBe(0);
  });
});
