import { describe, expect, it } from "vitest";
import {
  adaptiveTdee,
  addDays,
  aggregateShopping,
  allergenAlerts,
  applyConditions,
  bmr,
  checkInteractions,
  ciqualNutrients,
  computeMacroTargets,
  computeMicroTargets,
  conditionFoodAlerts,
  cyclePhase,
  dailyQualityScore,
  detectSubstance,
  DRUG_FOOD_INTERACTIONS,
  exerciseKcal,
  familyPortions,
  forecastWeight,
  ingredientKey,
  lockFromAbsolute,
  microGaps,
  normalizeOff,
  parseCiqualValue,
  parseDateShorthand,
  parseIngredient,
  rankAlternatives,
  rebalanceMacros,
  recipeNutrition,
  scaleNutrients,
  scaleRecipe,
  streak,
  symptomCorrelations,
  upfKcalPct,
  weekStart,
  type DayPoint,
} from "../src";

describe("normalizeOff", () => {
  const product = {
    code: "8480000123456",
    product_name: "Yogur natural",
    product_name_es: "Yogur natural",
    brands: "Hacendado, Mercadona",
    quantity: "4 x 125 g",
    serving_size: "125 g",
    serving_quantity: 125,
    nutriments: {
      "energy-kcal_100g": 61,
      proteins_100g: 3.5,
      carbohydrates_100g: 4.7,
      sugars_100g: 4.7,
      fat_100g: 3.1,
      "saturated-fat_100g": 2,
      salt_100g: 0.13,
      calcium_100g: 0.12, // grams → 120 mg
      "vitamin-d_100g": 0.0000012, // grams → 1.2 µg
    },
    nutriscore_grade: "a",
    nova_group: 1,
    allergens_tags: ["en:milk"],
    categories_tags: ["en:dairies", "en:yogurts", "en:natural-yogurts"],
  };

  it("convierte unidades de OFF (gramos) a mg/µg y deriva sodio", () => {
    const f = normalizeOff(product)!;
    expect(f.name).toBe("Yogur natural");
    expect(f.brand).toBe("Hacendado");
    expect(f.nutrients.energy_kcal).toBe(61);
    expect(f.nutrients.calcium).toBeCloseTo(120);
    expect(f.nutrients.vit_d).toBeCloseTo(1.2);
    expect(f.nutrients.sodium).toBeCloseTo(52);
    expect(f.nova).toBe(1);
    expect(f.servings[0]).toMatchObject({ grams: 125, isDefault: true });
  });

  it("calcula kcal desde kJ si falta y descarta productos sin nombre", () => {
    const f = normalizeOff({ code: "1", product_name: "X", nutriments: { "energy-kj_100g": 418.4 } })!;
    expect(f.nutrients.energy_kcal).toBeCloseTo(100);
    expect(normalizeOff({ code: "2" })).toBeNull();
  });
});

describe("CIQUAL", () => {
  it("interpreta trazas, < y comas", () => {
    expect(parseCiqualValue("traces")).toBe(0);
    expect(parseCiqualValue("< 0,5")).toBe(0.25);
    expect(parseCiqualValue("12,3")).toBe(12.3);
    expect(parseCiqualValue("-")).toBeUndefined();
  });
  it("mapea constituyentes por nombre", () => {
    const n = ciqualNutrients({
      "Energie, Règlement UE N° 1169/2011 (kcal/100 g)": "89",
      "Protéines, N x facteur de Jones (g/100 g)": "1,06",
      "Fer (mg/100 g)": "0,27",
      "Rétinol (µg/100 g)": "0",
      "Beta-Carotène (µg/100 g)": "24",
    });
    expect(n.energy_kcal).toBe(89);
    expect(n.iron).toBe(0.27);
    expect(n.vit_a).toBeCloseTo(2);
  });
});

describe("totales", () => {
  it("escala por gramos y respeta valores bloqueados", () => {
    const m = scaleNutrients({ energy_kcal: 200, protein: 10 }, 150, { protein: 12 });
    expect(m.energy_kcal).toBe(300);
    expect(m.protein).toBeCloseTo(18);
    expect(lockFromAbsolute(30, 150)).toBe(20);
  });
});

describe("objetivos", () => {
  const p = { sex: "male" as const, age: 30, weightKg: 80, heightCm: 180, activityLevel: "moderate" as const, goalType: "lose" as const, weeklyRateKg: -0.5 };
  it("Mifflin-St Jeor", () => {
    expect(bmr(p)).toBe(10 * 80 + 6.25 * 180 - 5 * 30 + 5);
  });
  it("aplica déficit y suelo calórico", () => {
    const t = computeMacroTargets(p);
    expect(t.tdee).toBe(Math.round(1780 * 1.55));
    expect(t.kcal).toBe(Math.round(1780 * 1.55 - 550));
    expect(t.protein).toBe(Math.round(1.6 * 80));
    const tiny = computeMacroTargets({ ...p, sex: "female", weightKg: 45, heightCm: 150, age: 60, activityLevel: "sedentary", weeklyRateKg: -1 });
    expect(tiny.kcal).toBeGreaterThanOrEqual(1200);
    expect(tiny.floorApplied).toBe(true);
  });
  it("embarazo: sin déficit y con kcal extra; IR específicas", () => {
    const t = computeMacroTargets({ ...p, sex: "female", goalType: "maintain", weeklyRateKg: -0.5, pregnancy: "trimester3" });
    const base = computeMacroTargets({ ...p, sex: "female", goalType: "maintain", weeklyRateKg: 0 });
    expect(t.kcal - base.kcal).toBe(500);
    const micros = computeMicroTargets({ sex: "female", age: 30, pregnancy: "trimester2" }, 2200);
    expect(micros.folate?.min).toBe(600);
    expect(micros.iodine?.min).toBe(200);
    expect(micros.alcohol?.max).toBe(0);
  });
  it("hierro distinto en mujer fértil, posmenopausia y niños", () => {
    expect(computeMicroTargets({ sex: "female", age: 30 }, 2000).iron?.min).toBe(16);
    expect(computeMicroTargets({ sex: "female", age: 55 }, 2000).iron?.min).toBe(11);
    expect(computeMicroTargets({ sex: "male", age: 5 }, 1400).iron?.min).toBe(7);
  });
  it("reequilibra macros respetando los fijados", () => {
    const r = rebalanceMacros({ kcal: 2000, protein: 150, carbs: 200, fat: 67 }, 1800, ["protein"]);
    expect(r.protein).toBe(150);
    expect(r.carbs * 4 + r.fat * 9).toBeCloseTo(1800 - 600, -1);
  });
});

describe("TDEE adaptativo", () => {
  /** Synthetic person: true TDEE 2500, eats 2000 → loses 500*7/7700 kg/week. */
  function series(days: number, intake: number, trueTdee: number, logFactor = 1): DayPoint[] {
    const start = "2026-01-01";
    let w = 85;
    const pts: DayPoint[] = [];
    for (let i = 0; i < days; i++) {
      w += (intake - trueTdee) / 7700;
      const noise = Math.sin(i * 1.7) * 0.4;
      pts.push({ date: addDays(start, i), intakeKcal: intake * logFactor, weightKg: i % 2 === 0 ? w + noise : null });
    }
    return pts;
  }
  const opts = { formulaTdee: 2400, bmr: 1750 };

  it("estima el gasto real a partir de ingesta y tendencia de peso", () => {
    const pts = series(60, 2000, 2500);
    const r = adaptiveTdee(pts, pts.at(-1)!.date, opts);
    expect(r.adaptiveTdee).toBeGreaterThan(2300);
    expect(r.adaptiveTdee).toBeLessThan(2700);
    expect(r.confidence).toBeGreaterThan(0.6);
    expect(r.underLoggingSuspected).toBe(false);
  });

  it("detecta registro incompleto", () => {
    const pts = series(60, 2000, 2500, 0.55); // only 55% logged
    const r = adaptiveTdee(pts, pts.at(-1)!.date, opts);
    expect(r.underLoggingSuspected).toBe(true);
    expect(r.estimatedTdee).toBeGreaterThan(2000);
  });

  it("sin datos suficientes usa la fórmula", () => {
    const pts = series(5, 2000, 2500);
    const r = adaptiveTdee(pts, pts.at(-1)!.date, opts);
    expect(r.confidence).toBe(0);
    expect(r.estimatedTdee).toBe(2400);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("previsión de peso", () => {
    const f = forecastWeight({ fromDate: "2026-03-01", currentTrendKg: 80, plannedIntake: 2000, tdee: 2770, horizons: [70] });
    expect(f[0]!.weightKg).toBe(73);
  });
});

describe("calidad y alérgenos", () => {
  it("porcentaje de ultraprocesados y puntuación", () => {
    const entries = [
      { kcal: 500, nova: 4, nutriscore: "e" },
      { kcal: 500, nova: 1, nutriscore: "a" },
    ];
    expect(upfKcalPct(entries)).toBe(50);
    const s = dailyQualityScore(entries, { energy_kcal: 1000, fiber: 10 }, { kcal: 2000 })!;
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(80);
  });
  it("alerta de alérgenos y trazas", () => {
    const a = allergenAlerts({ allergens: ["en:milk"], traces: ["en:nuts"] }, ["leche", "frutos_secos", "huevo"]);
    expect(a).toEqual([
      { allergen: "leche", nameEs: "Leche", level: "contains" },
      { allergen: "frutos_secos", nameEs: "Frutos de cáscara", level: "traces" },
    ]);
  });
  it("alternativas más sanas en la misma categoría", () => {
    const base = { id: "1", name: "Galletas choco", nutriscore: "e", nova: 4, categories: ["en:snacks", "en:biscuits"] };
    const alts = rankAlternatives(base, [
      { id: "2", name: "Galletas avena", nutriscore: "b", nova: 3, categories: ["en:snacks", "en:biscuits"] },
      { id: "3", name: "Patatas", nutriscore: "a", nova: 1, categories: ["en:chips"] },
      { id: "4", name: "Galletas peores", nutriscore: "e", nova: 4, categories: ["en:biscuits"] },
    ]);
    expect(alts.map((a) => a.id)).toEqual(["2"]);
  });
});

describe("condiciones e interacciones", () => {
  it("hipertensión baja el sodio máximo; celiaquía alerta gluten", () => {
    const t = applyConditions({ kcal: 2000, protein: 100, carbs: 250, fat: 66, micros: { sodium: { max: 2000 } } }, [{ code: "hypertension" }], 70);
    expect(t.micros.sodium?.max).toBe(1500);
    const alerts = conditionFoodAlerts({ name: "Pan de trigo", nutrients: {} }, [{ code: "celiac" }], 70);
    expect(alerts[0]?.level).toBe("avoid");
  });
  it("diabetes avisa de hidratos por comida", () => {
    const a = conditionFoodAlerts({ name: "Arroz", nutrients: { carbs: 90, fiber: 1, sugars: 0 } }, [{ code: "diabetes", config: { carbsPerMeal: 50 } }], 70);
    expect(a.some((x) => x.message.includes("90 g"))).toBe(true);
  });
  it("detecta fármaco e interacciones", () => {
    expect(detectSubstance("Sintrom 4 mg")).toBe("warfarin");
    expect(detectSubstance("Eutirox 100")).toBe("levothyroxine");
    const hits = checkInteractions(
      { name: "Zumo de pomelo", nutrients: {} },
      [{ name: "Simvastatina", substanceCode: "statin_cyp3a4" }],
      DRUG_FOOD_INTERACTIONS,
    );
    expect(hits[0]?.severity).toBe("avoid");
    const spinach = checkInteractions({ name: "Espinacas", nutrients: { vit_k: 480 } }, [{ name: "Sintrom", substanceCode: "warfarin" }], DRUG_FOOD_INTERACTIONS);
    expect(spinach.length).toBe(1);
  });
});

describe("cocina", () => {
  it("parsea ingredientes en español", () => {
    expect(parseIngredient("200 g de garbanzos cocidos")).toMatchObject({ quantity: 200, unit: "g", name: "garbanzos cocidos", grams: 200 });
    expect(parseIngredient("2 cucharadas de aceite de oliva")).toMatchObject({ quantity: 2, unit: "cucharadas", grams: 30 });
    expect(parseIngredient("1/2 cebolla")).toMatchObject({ quantity: 0.5, grams: 75 });
    expect(parseIngredient("3 huevos")).toMatchObject({ quantity: 3, grams: 165 });
    expect(parseIngredient("Sal al gusto")).toMatchObject({ quantity: null, optional: true });
    expect(parseIngredient("1 lata de tomate triturado (400 g)").grams).toBe(400);
  });
  it("clave de ingrediente normalizada", () => {
    expect(ingredientKey("Cebollas rojas picadas")).toBe(ingredientKey("cebolla roja"));
    expect(ingredientKey("Tomates")).toBe("tomat");
  });
  it("nutrición y coste por ración, escalado", () => {
    const r = recipeNutrition(
      [
        { grams: 200, per100: { energy_kcal: 100, protein: 5 }, pricePerKg: 2 },
        { grams: 100, per100: { energy_kcal: 300 }, pricePerKg: 10 },
        { grams: null, per100: null, optional: true },
      ],
      2,
    );
    expect(r.total.energy_kcal).toBe(500);
    expect(r.perServing.energy_kcal).toBe(250);
    expect(r.costPerServing).toBe(0.7);
    expect(r.missing).toBe(0);
    expect(scaleRecipe([{ grams: 100, quantity: 1 }], 2, 4)[0]).toEqual({ grams: 200, quantity: 2 });
  });
  it("raciones familiares proporcionales", () => {
    const p = familyPortions(
      [
        { personId: "a", dailyKcal: 2800, slotShare: 0.35 },
        { personId: "b", dailyKcal: 1600, slotShare: 0.35 },
        { personId: "c", dailyKcal: 1200, slotShare: 0.35 },
      ],
      500,
    );
    expect(p.a!.servings).toBeGreaterThan(p.b!.servings);
    expect(p.c!.servings).toBe(0.75);
  });
  it("lista de la compra: agrega y resta despensa", () => {
    const lines = aggregateShopping(
      [
        { key: "tomat", name: "tomates", grams: 300, recipeId: "r1" },
        { key: "tomat", name: "tomate", grams: 200, recipeId: "r2" },
        { key: "sal", name: "sal", grams: 5 },
        { key: "arroz", name: "arroz", grams: 400 },
      ],
      [
        { key: "sal", grams: null, staple: true },
        { key: "arroz", grams: 1000 },
        { key: "tomat", grams: 100 },
      ],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ key: "tomat", grams: 400, category: "fruta_verdura", fromRecipes: ["r1", "r2"] });
  });
  it("atajos de fecha", () => {
    const today = new Date(2026, 10, 8);
    expect(parseDateShorthand("+1m", today)).toBe("2026-12-08");
    expect(parseDateShorthand("+10d", today)).toBe("2026-11-18");
    expect(parseDateShorthand("202602e", today)).toBe("2026-02-28");
    expect(parseDateShorthand("0105", today)).toBe("2027-01-05");
    expect(parseDateShorthand("x", today)).toBe("never");
  });
});

describe("insights", () => {
  it("correlación alimento → síntoma", () => {
    const h = 3_600_000;
    const exposures = [];
    const symptoms = [];
    for (let d = 0; d < 20; d++) {
      const t = d * 24 * h;
      exposures.push({ at: t, key: d % 2 === 0 ? "leche" : "arroz" });
      exposures.push({ at: t + 6 * h, key: "pollo" });
      if (d % 2 === 0) symptoms.push({ at: t + 3 * h, symptom: "hinchazón", intensity: 3 });
    }
    const c = symptomCorrelations(exposures, symptoms);
    expect(c[0]?.key).toBe("leche");
    expect(c.find((x) => x.key === "arroz")).toBeUndefined();
  });
  it("rachas", () => {
    expect(streak(["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-01"], "2026-11-08")).toEqual({ current: 3, best: 3, lastDate: "2026-11-07" });
  });
  it("carencias de micros", () => {
    const gaps = microGaps([{ iron: 5 }, { iron: 6 }], { iron: { min: 16 } });
    expect(gaps[0]).toMatchObject({ code: "iron", kind: "low" });
  });
  it("actividad, ciclo y semana", () => {
    expect(exerciseKcal(8, 70, 60)).toBe(490);
    expect(cyclePhase("2026-11-01", "2026-11-02").phase).toBe("menstrual");
    expect(cyclePhase("2026-11-01", "2026-11-20", 28).phase).toBe("luteal");
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
  });
});
