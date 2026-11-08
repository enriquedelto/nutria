/**
 * Nutrient catalogue: single source of truth for codes, units and source mappings.
 * Amounts in a NutrientMap are always in `unit` (per 100 g for foods, absolute for entries).
 */
export type NutrientUnit = "kcal" | "kJ" | "g" | "mg" | "µg";
export type NutrientCategory = "energy" | "macro" | "carb_detail" | "fat_detail" | "vitamin" | "mineral" | "other";

export interface NutrientDef {
  code: string;
  nameEs: string;
  nameEn: string;
  unit: NutrientUnit;
  category: NutrientCategory;
  /** Open Food Facts nutriments key (value in `<key>_100g`, mass in grams). */
  off?: string;
  /** Regex matched against CIQUAL constituent names (const_nom_fr). */
  ciqual?: RegExp;
  /** EFSA tolerable upper intake level for adults (same unit). */
  ul?: number;
  /** Shown by default on the micro panel. */
  core?: boolean;
}

export const NUTRIENTS: NutrientDef[] = [
  { code: "energy_kcal", nameEs: "Energía", nameEn: "Energy", unit: "kcal", category: "energy", off: "energy-kcal", ciqual: /^Energie, Règlement UE N° 1169\/2011 \(kcal/i, core: true },
  { code: "protein", nameEs: "Proteínas", nameEn: "Protein", unit: "g", category: "macro", off: "proteins", ciqual: /^Protéines, N x facteur de Jones/i, core: true },
  { code: "carbs", nameEs: "Hidratos de carbono", nameEn: "Carbohydrates", unit: "g", category: "macro", off: "carbohydrates", ciqual: /^Glucides \(g/i, core: true },
  { code: "sugars", nameEs: "Azúcares", nameEn: "Sugars", unit: "g", category: "carb_detail", off: "sugars", ciqual: /^Sucres \(g/i, core: true },
  { code: "added_sugars", nameEs: "Azúcares añadidos", nameEn: "Added sugars", unit: "g", category: "carb_detail", off: "added-sugars" },
  { code: "starch", nameEs: "Almidón", nameEn: "Starch", unit: "g", category: "carb_detail", off: "starch", ciqual: /^Amidon \(g/i },
  { code: "polyols", nameEs: "Polialcoholes", nameEn: "Polyols", unit: "g", category: "carb_detail", off: "polyols", ciqual: /^Polyols totaux/i },
  { code: "fiber", nameEs: "Fibra", nameEn: "Fiber", unit: "g", category: "macro", off: "fiber", ciqual: /^Fibres alimentaires/i, core: true },
  { code: "fat", nameEs: "Grasas", nameEn: "Fat", unit: "g", category: "macro", off: "fat", ciqual: /^Lipides \(g/i, core: true },
  { code: "sat_fat", nameEs: "Grasas saturadas", nameEn: "Saturated fat", unit: "g", category: "fat_detail", off: "saturated-fat", ciqual: /^AG saturés/i, core: true },
  { code: "mono_fat", nameEs: "Grasas monoinsaturadas", nameEn: "Monounsaturated fat", unit: "g", category: "fat_detail", off: "monounsaturated-fat", ciqual: /^AG monoinsaturés/i },
  { code: "poly_fat", nameEs: "Grasas poliinsaturadas", nameEn: "Polyunsaturated fat", unit: "g", category: "fat_detail", off: "polyunsaturated-fat", ciqual: /^AG polyinsaturés/i },
  { code: "trans_fat", nameEs: "Grasas trans", nameEn: "Trans fat", unit: "g", category: "fat_detail", off: "trans-fat" },
  { code: "omega3", nameEs: "Omega-3", nameEn: "Omega-3", unit: "g", category: "fat_detail", off: "omega-3-fat" },
  { code: "ala", nameEs: "Ácido alfa-linolénico (ALA)", nameEn: "ALA", unit: "g", category: "fat_detail", off: "alpha-linolenic-acid", ciqual: /^AG 18:3 c9,c12,c15 \(n-3\)/i },
  { code: "epa_dha", nameEs: "EPA + DHA", nameEn: "EPA + DHA", unit: "g", category: "fat_detail" },
  { code: "epa", nameEs: "EPA", nameEn: "EPA", unit: "g", category: "fat_detail", off: "eicosapentaenoic-acid", ciqual: /^AG 20:5 .*EPA/i },
  { code: "dha", nameEs: "DHA", nameEn: "DHA", unit: "g", category: "fat_detail", off: "docosahexaenoic-acid", ciqual: /^AG 22:6 .*DHA/i },
  { code: "omega6", nameEs: "Omega-6", nameEn: "Omega-6", unit: "g", category: "fat_detail", off: "omega-6-fat" },
  { code: "la", nameEs: "Ácido linoleico", nameEn: "Linoleic acid", unit: "g", category: "fat_detail", off: "linoleic-acid", ciqual: /^AG 18:2 9c,12c \(n-6\)/i },
  { code: "cholesterol", nameEs: "Colesterol", nameEn: "Cholesterol", unit: "mg", category: "fat_detail", off: "cholesterol", ciqual: /^Cholestérol/i },
  { code: "salt", nameEs: "Sal", nameEn: "Salt", unit: "g", category: "mineral", off: "salt", ciqual: /^Sel chlorure de sodium/i, core: true },
  { code: "sodium", nameEs: "Sodio", nameEn: "Sodium", unit: "mg", category: "mineral", off: "sodium", ciqual: /^Sodium \(mg/i, core: true },
  { code: "potassium", nameEs: "Potasio", nameEn: "Potassium", unit: "mg", category: "mineral", off: "potassium", ciqual: /^Potassium \(mg/i, core: true },
  { code: "calcium", nameEs: "Calcio", nameEn: "Calcium", unit: "mg", category: "mineral", off: "calcium", ciqual: /^Calcium \(mg/i, ul: 2500, core: true },
  { code: "phosphorus", nameEs: "Fósforo", nameEn: "Phosphorus", unit: "mg", category: "mineral", off: "phosphorus", ciqual: /^Phosphore \(mg/i },
  { code: "magnesium", nameEs: "Magnesio", nameEn: "Magnesium", unit: "mg", category: "mineral", off: "magnesium", ciqual: /^Magnésium \(mg/i, core: true },
  { code: "iron", nameEs: "Hierro", nameEn: "Iron", unit: "mg", category: "mineral", off: "iron", ciqual: /^Fer \(mg/i, core: true },
  { code: "zinc", nameEs: "Zinc", nameEn: "Zinc", unit: "mg", category: "mineral", off: "zinc", ciqual: /^Zinc \(mg/i, ul: 25, core: true },
  { code: "copper", nameEs: "Cobre", nameEn: "Copper", unit: "mg", category: "mineral", off: "copper", ciqual: /^Cuivre \(mg/i, ul: 5 },
  { code: "manganese", nameEs: "Manganeso", nameEn: "Manganese", unit: "mg", category: "mineral", off: "manganese", ciqual: /^Manganèse \(mg/i },
  { code: "selenium", nameEs: "Selenio", nameEn: "Selenium", unit: "µg", category: "mineral", off: "selenium", ciqual: /^Sélénium/i, ul: 255 },
  { code: "iodine", nameEs: "Yodo", nameEn: "Iodine", unit: "µg", category: "mineral", off: "iodine", ciqual: /^Iode/i, ul: 600, core: true },
  { code: "fluoride", nameEs: "Flúor", nameEn: "Fluoride", unit: "mg", category: "mineral", off: "fluoride" },
  { code: "vit_a", nameEs: "Vitamina A", nameEn: "Vitamin A", unit: "µg", category: "vitamin", off: "vitamin-a", core: true },
  { code: "retinol", nameEs: "Retinol", nameEn: "Retinol", unit: "µg", category: "vitamin", ciqual: /^Rétinol/i, ul: 3000 },
  { code: "beta_carotene", nameEs: "Betacaroteno", nameEn: "Beta-carotene", unit: "µg", category: "vitamin", off: "beta-carotene", ciqual: /^Beta-Carotène/i },
  { code: "vit_d", nameEs: "Vitamina D", nameEn: "Vitamin D", unit: "µg", category: "vitamin", off: "vitamin-d", ciqual: /^Vitamine D/i, ul: 100, core: true },
  { code: "vit_e", nameEs: "Vitamina E", nameEn: "Vitamin E", unit: "mg", category: "vitamin", off: "vitamin-e", ciqual: /^Vitamine E/i, ul: 300 },
  { code: "vit_k", nameEs: "Vitamina K", nameEn: "Vitamin K", unit: "µg", category: "vitamin", off: "vitamin-k", ciqual: /^Vitamine K1/i },
  { code: "vit_c", nameEs: "Vitamina C", nameEn: "Vitamin C", unit: "mg", category: "vitamin", off: "vitamin-c", ciqual: /^Vitamine C/i, core: true },
  { code: "vit_b1", nameEs: "Tiamina (B1)", nameEn: "Thiamin (B1)", unit: "mg", category: "vitamin", off: "vitamin-b1", ciqual: /^Vitamine B1/i },
  { code: "vit_b2", nameEs: "Riboflavina (B2)", nameEn: "Riboflavin (B2)", unit: "mg", category: "vitamin", off: "vitamin-b2", ciqual: /^Vitamine B2/i },
  { code: "vit_b3", nameEs: "Niacina (B3)", nameEn: "Niacin (B3)", unit: "mg", category: "vitamin", off: "vitamin-pp", ciqual: /^Vitamine B3/i },
  { code: "vit_b5", nameEs: "Ácido pantoténico (B5)", nameEn: "Pantothenic acid (B5)", unit: "mg", category: "vitamin", off: "pantothenic-acid", ciqual: /^Vitamine B5/i },
  { code: "vit_b6", nameEs: "Vitamina B6", nameEn: "Vitamin B6", unit: "mg", category: "vitamin", off: "vitamin-b6", ciqual: /^Vitamine B6/i, ul: 12 },
  { code: "biotin", nameEs: "Biotina (B8)", nameEn: "Biotin", unit: "µg", category: "vitamin", off: "biotin" },
  { code: "folate", nameEs: "Folato (B9)", nameEn: "Folate (B9)", unit: "µg", category: "vitamin", off: "vitamin-b9", ciqual: /^Vitamine B9/i, core: true },
  { code: "vit_b12", nameEs: "Vitamina B12", nameEn: "Vitamin B12", unit: "µg", category: "vitamin", off: "vitamin-b12", ciqual: /^Vitamine B12/i, core: true },
  { code: "choline", nameEs: "Colina", nameEn: "Choline", unit: "mg", category: "vitamin", off: "choline" },
  { code: "caffeine", nameEs: "Cafeína", nameEn: "Caffeine", unit: "mg", category: "other", off: "caffeine" },
  { code: "alcohol", nameEs: "Alcohol", nameEn: "Alcohol", unit: "g", category: "other", ciqual: /^Alcool \(g/i },
  { code: "water", nameEs: "Agua", nameEn: "Water", unit: "g", category: "other", ciqual: /^Eau \(g/i },
];

export const NUTRIENT_BY_CODE: Record<string, NutrientDef> = Object.fromEntries(NUTRIENTS.map((n) => [n.code, n]));

export const MACRO_CODES = ["energy_kcal", "protein", "carbs", "fat", "fiber"] as const;
export const CORE_MICROS = NUTRIENTS.filter((n) => n.core && (n.category === "vitamin" || n.category === "mineral")).map((n) => n.code);

/** Factor to convert grams into the nutrient's unit. */
export function gramsToUnit(unit: NutrientUnit): number {
  switch (unit) {
    case "g":
      return 1;
    case "mg":
      return 1000;
    case "µg":
      return 1_000_000;
    default:
      return 1;
  }
}

export function round(value: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Sensible display precision per unit/magnitude. */
export function displayAmount(value: number, unit: NutrientUnit): string {
  const d = unit === "kcal" ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : value >= 1 ? 1 : 2;
  return `${round(value, d).toLocaleString("es-ES")} ${unit}`;
}
