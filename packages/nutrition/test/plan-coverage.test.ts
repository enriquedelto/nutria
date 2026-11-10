import { describe, expect, it } from "vitest";
import { batchSuggestions, planCoverage } from "../src";

describe("cobertura del plan", () => {
  const dish = (date: string, servings: number, kcal: number | null, protein: number | null, recipeId: string | null = "r") => ({ date, recipeId, title: "x", servings, kcalPerServing: kcal, proteinPerServing: protein });
  const targets = { "2026-11-09": { kcal: 3000, protein: 150 }, "2026-11-10": { kcal: 2700, protein: 150 }, "2026-11-11": { kcal: 2700, protein: 150 } };
  it("compara cada día con su objetivo (entreno o descanso) y avisa de los cortos", () => {
    const c = planCoverage(
      ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"],
      [dish("2026-11-09", 2, 700, 40), dish("2026-11-09", 1.5, 800, 45), dish("2026-11-10", 1, 600, 30), dish("2026-11-10", 1, 700, 35), dish("2026-11-11", 1, 600, 30), dish("2026-11-11", 1, null, null, null)],
      targets,
    );
    expect(c[0]).toMatchObject({ kcal: 2600, protein: 148, targetKcal: 3000, status: "ok" });
    expect(c[1]).toMatchObject({ kcal: 1300, protein: 65, status: "short" });
    expect(c[2]).toMatchObject({ dishes: 2, unknown: 1, status: "partial" });
    expect(c[3]).toMatchObject({ dishes: 0, status: "empty", targetKcal: null });
  });
  it("cocina por lotes: mismas recetas en varios días, según lo que aguantan", () => {
    const items = [
      { recipeId: "a", title: "Lentejas", date: "2026-11-09", servings: 3 },
      { recipeId: "a", title: "Lentejas", date: "2026-11-11", servings: 3.5 },
      { recipeId: "b", title: "Pollo al curry", date: "2026-11-09", servings: 2 },
      { recipeId: "b", title: "Pollo al curry", date: "2026-11-14", servings: 2 },
      { recipeId: "c", title: "Arroz", date: "2026-11-10", servings: 2 },
      { recipeId: "c", title: "Arroz", date: "2026-11-15", servings: 2 },
      { recipeId: "d", title: "Ensalada", date: "2026-11-10", servings: 2 },
      { recipeId: null, title: "Libre", date: "2026-11-10", servings: 2 },
    ];
    const b = batchSuggestions(items, { a: { fridgeDays: 4, freezable: true }, b: { fridgeDays: 3, freezable: true }, c: { fridgeDays: null, freezable: false } });
    expect(b.map((x) => [x.title, x.servings, x.storage])).toEqual([
      ["Lentejas", 6.5, "fridge"],
      ["Pollo al curry", 4, "freeze"],
      ["Arroz", 4, "split"],
    ]);
  });
});
