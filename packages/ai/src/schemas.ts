/** Zod output schemas for every structured AI feature (validated on both backends). */
import { z } from "zod";

/** Nutrients per 100 g keyed by our nutrient codes (energy_kcal, protein, carbs, fat, fiber, sugars, sat_fat, salt, …). */
export const Per100 = z
  .array(z.object({ code: z.string(), amount: z.number() }))
  .describe("Nutrientes por 100 g con códigos de Nutria (energy_kcal, protein, carbs, fat, fiber, sugars, sat_fat, salt, sodium, iron…); unidades: g, mg o µg según el nutriente");
export type Per100 = z.infer<typeof Per100>;
export const per100ToMap = (p: Per100): Record<string, number> => Object.fromEntries(p.map((x) => [x.code, x.amount]));

export const MealSlotCode = z.enum(["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "late_snack"]);

export const MealItem = z.object({
  name: z.string().describe("Nombre en español, concreto (p. ej. 'arroz blanco cocido')"),
  searchQuery: z.string().describe("Consulta corta para buscar el alimento en la base de datos"),
  brand: z.string().nullable().optional(),
  grams: z.number().describe("Gramos estimados de la porción tal como se come"),
  servingLabel: z.string().nullable().optional().describe("Medida casera: '1 plato', '2 cucharadas'"),
  confidence: z.number().describe("0 a 1"),
  per100: Per100.describe("Estimación por 100 g, por si no se encuentra el alimento"),
});
export type MealItem = z.infer<typeof MealItem>;

export const MealEstimate = z.object({
  items: z.array(MealItem),
  mealSlot: MealSlotCode.nullable().optional(),
  notes: z.string().nullable().optional(),
  questions: z.array(z.string()).describe("Preguntas para afinar si algo es ambiguo (máx. 2)").default([]),
});
export type MealEstimate = z.infer<typeof MealEstimate>;

export const LabelReading = z.object({
  name: z.string(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  servingGrams: z.number().nullable(),
  per100: Per100,
  ingredientsText: z.string().nullable(),
  allergens: z.array(z.string()),
  confidence: z.number(),
});
export type LabelReading = z.infer<typeof LabelReading>;

export const LabReportExtraction = z.object({
  date: z.string().nullable().describe("Fecha de la extracción YYYY-MM-DD"),
  labName: z.string().nullable(),
  results: z.array(
    z.object({
      rawName: z.string(),
      parameterCode: z.string().nullable().describe("Código de parámetro de la lista dada, o null"),
      value: z.number(),
      unit: z.string(),
      refLow: z.number().nullable(),
      refHigh: z.number().nullable(),
    }),
  ),
});
export type LabReportExtraction = z.infer<typeof LabReportExtraction>;

export const RecipeStructure = z.object({
  title: z.string(),
  description: z.string().nullable(),
  servings: z.number().nullable(),
  prepMin: z.number().nullable(),
  cookMin: z.number().nullable(),
  ingredients: z.array(z.string()).describe("Una línea por ingrediente con cantidad y unidad en español: '200 g de arroz'"),
  steps: z.array(z.object({ text: z.string(), section: z.string().nullable().optional(), timerMin: z.number().nullable().optional() })),
  tags: z.array(z.string()),
});
export type RecipeStructure = z.infer<typeof RecipeStructure>;

export const FoodTranslations = z.object({
  items: z.array(z.object({ id: z.string(), nameEs: z.string() })),
});

export const PantryPhoto = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      unit: z.enum(["g", "ml", "ud"]),
      location: z.enum(["nevera", "congelador", "despensa"]),
      expiresInDays: z.number().nullable(),
    }),
  ),
});

export const MealPlanDraft = z.object({
  days: z.array(
    z.object({
      date: z.string().describe("YYYY-MM-DD"),
      meals: z.array(
        z.object({
          mealSlot: MealSlotCode,
          recipeId: z.string().nullable().describe("id de una receta existente si encaja"),
          title: z.string(),
          ingredients: z.array(z.string()).describe("Solo si no es una receta existente"),
          servingsByPerson: z.array(z.object({ personId: z.string(), servings: z.number() })),
          prepMin: z.number().nullable(),
          why: z.string().describe("Por qué encaja (objetivo, despensa, gustos)"),
        }),
      ),
    }),
  ),
  notes: z.string().nullable(),
});
export type MealPlanDraft = z.infer<typeof MealPlanDraft>;

export const WeeklyReport = z.object({
  title: z.string(),
  summaryMd: z.string(),
  highlights: z.array(z.string()),
  suggestions: z.array(z.string()),
});
export type WeeklyReport = z.infer<typeof WeeklyReport>;

export const Substitutions = z.object({
  options: z.array(z.object({ ingredient: z.string(), substitute: z.string(), reason: z.string(), ratio: z.string().nullable() })),
});

export const WhatToEat = z.object({
  options: z.array(
    z.object({
      title: z.string(),
      why: z.string(),
      recipeId: z.string().nullable().optional(),
      items: z.array(z.object({ name: z.string(), grams: z.number(), foodId: z.string().nullable().optional() })),
    }),
  ),
});
export type WhatToEat = z.infer<typeof WhatToEat>;

export const CorrelationExplanation = z.object({ bodyMd: z.string() });

export const MemoryExtract = z.object({
  memories: z.array(
    z.object({
      category: z.enum(["gustos", "rutina", "salud", "objetivos", "cocina", "otros"]),
      contentMd: z.string(),
    }),
  ),
});

export const RetroSummary = z.object({
  householdMd: z.string().describe("Preferencias del hogar actualizadas en markdown"),
  perPerson: z.array(z.object({ personId: z.string(), preferencesMd: z.string() })),
});
