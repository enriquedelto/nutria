/**
 * Normalizers: Open Food Facts product JSON and CIQUAL composition rows → FoodInput.
 */
import { gramsToUnit, NUTRIENTS } from "./nutrients";
import { completeDerived, type NutrientMap } from "./totals";

export interface FoodInput {
  source: "off" | "ciqual" | "usda" | "custom" | "ai" | "recipe" | "store";
  sourceId: string | null;
  barcode: string | null;
  kind: "food" | "drink" | "supplement" | "alcohol";
  name: string;
  nameEs: string | null;
  brand: string | null;
  quantityLabel: string | null;
  imageUrl: string | null;
  nutrients: NutrientMap;
  density: number;
  nutriscore: string | null;
  nova: number | null;
  ecoscore: string | null;
  additives: string[];
  allergens: string[];
  traces: string[];
  categories: string[];
  labels: string[];
  ingredientsText: string | null;
  countries: string[];
  completeness: number | null;
  servings: { label: string; grams: number; isDefault?: boolean }[];
}

/* ------------------------------- Open Food Facts ------------------------------ */

// Minimal shape of an OFF product (API v2 / JSONL dump).
export interface OffProduct {
  code?: string;
  _id?: string;
  product_name?: string;
  product_name_es?: string;
  generic_name_es?: string;
  brands?: string;
  quantity?: string;
  image_front_url?: string;
  image_url?: string;
  image_front_small_url?: string;
  nutriments?: Record<string, number | string | undefined>;
  nutriscore_grade?: string;
  nutrition_grades?: string;
  nova_group?: number | string;
  ecoscore_grade?: string;
  additives_tags?: string[];
  allergens_tags?: string[];
  traces_tags?: string[];
  categories_tags?: string[];
  labels_tags?: string[];
  ingredients_text_es?: string;
  ingredients_text?: string;
  countries_tags?: string[];
  serving_size?: string;
  serving_quantity?: number | string;
  nutrition_data_per?: string;
  completeness?: number | string;
  product_quantity?: number | string;
  product_quantity_unit?: string;
}

const num = (v: unknown): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};

const DRINK_CATEGORIES = ["en:beverages", "en:drinks", "en:waters", "en:juices", "en:milks", "en:sodas", "en:plant-based-milk-alternatives"];
const ALCOHOL_CATEGORIES = ["en:alcoholic-beverages", "en:wines", "en:beers", "en:spirits", "en:ciders"];
const SUPPLEMENT_CATEGORIES = ["en:dietary-supplements", "en:food-supplements", "en:vitamins"];

export function offNutrients(nutriments: OffProduct["nutriments"] = {}): NutrientMap {
  const out: NutrientMap = {};
  for (const def of NUTRIENTS) {
    if (!def.off) continue;
    const v = num(nutriments[`${def.off}_100g`]);
    if (v == null || v < 0) continue;
    // OFF stores *_100g in grams for mass units (energy in kcal).
    out[def.code] = def.unit === "kcal" ? v : v * gramsToUnit(def.unit);
  }
  if (out.energy_kcal == null) {
    const kj = num(nutriments["energy-kj_100g"]) ?? num(nutriments["energy_100g"]);
    if (kj != null) out.energy_kcal = kj / 4.184;
  }
  const alcoholVol = num(nutriments["alcohol_100g"]);
  if (alcoholVol != null && alcoholVol > 0) out.alcohol = alcoholVol * 0.789; // % vol → g/100 ml
  return completeDerived(out);
}

/** Parse "30 g", "250 ml", "1 yogur (125 g)" into grams. */
export function parseGramsFromLabel(label: string | undefined | null): number | undefined {
  if (!label) return undefined;
  const m = label.replace(",", ".").match(/(\d+(?:\.\d+)?)\s*(kg|g|gr|gramos|ml|cl|l)\b/i);
  if (!m) return undefined;
  const v = Number(m[1]);
  switch (m[2]!.toLowerCase()) {
    case "kg":
    case "l":
      return v * 1000;
    case "cl":
      return v * 10;
    default:
      return v;
  }
}

export function normalizeOff(p: OffProduct): FoodInput | null {
  const code = p.code ?? p._id;
  const name = (p.product_name_es || p.product_name || p.generic_name_es || "").trim();
  if (!code || !name) return null;
  const categories = p.categories_tags ?? [];
  const kind: FoodInput["kind"] = categories.some((c) => ALCOHOL_CATEGORIES.includes(c))
    ? "alcohol"
    : categories.some((c) => SUPPLEMENT_CATEGORIES.includes(c))
      ? "supplement"
      : categories.some((c) => DRINK_CATEGORIES.includes(c))
        ? "drink"
        : "food";
  const grade = (p.nutriscore_grade ?? p.nutrition_grades ?? "").toLowerCase();
  const nova = num(p.nova_group);
  const servings: FoodInput["servings"] = [];
  const sq = num(p.serving_quantity) ?? parseGramsFromLabel(p.serving_size);
  if (sq && sq > 0) servings.push({ label: p.serving_size?.trim() || `1 ración (${sq} g)`, grams: sq, isDefault: true });
  const pq = num(p.product_quantity);
  if (pq && pq > 0 && pq !== sq && pq <= 2000) servings.push({ label: `Envase (${p.quantity ?? `${pq} g`})`, grams: pq });

  return {
    source: "off",
    sourceId: code,
    barcode: code,
    kind,
    name,
    nameEs: p.product_name_es?.trim() || null,
    brand: p.brands?.split(",")[0]?.trim() || null,
    quantityLabel: p.quantity?.trim() || null,
    imageUrl: p.image_front_small_url || p.image_front_url || p.image_url || null,
    nutrients: offNutrients(p.nutriments),
    density: 1,
    nutriscore: /^[a-e]$/.test(grade) ? grade : null,
    nova: nova && nova >= 1 && nova <= 4 ? nova : null,
    ecoscore: p.ecoscore_grade && /^[a-e]$/.test(p.ecoscore_grade) ? p.ecoscore_grade : null,
    additives: p.additives_tags ?? [],
    allergens: p.allergens_tags ?? [],
    traces: p.traces_tags ?? [],
    categories,
    labels: p.labels_tags ?? [],
    ingredientsText: p.ingredients_text_es || p.ingredients_text || null,
    countries: p.countries_tags ?? [],
    completeness: num(p.completeness) ?? null,
    servings,
  };
}

/* ----------------------------------- CIQUAL ---------------------------------- */

/** Parse CIQUAL values: "12,5", "< 0,5", "traces", "-" */
export function parseCiqualValue(raw: string | undefined | null): number | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === "-" || s === "nd") return undefined;
  if (s === "traces") return 0;
  const lt = s.startsWith("<");
  const n = Number(s.replace("<", "").replace(",", ".").trim());
  if (!Number.isFinite(n)) return undefined;
  return lt ? n / 2 : n; // half the detection limit
}

export interface CiqualRow {
  code: string;
  nameFr: string;
  nameEn?: string;
  nameEs?: string;
  group?: string;
  /** constituent name (French, as in CIQUAL) → raw value */
  values: Record<string, string>;
}

export function ciqualNutrients(values: Record<string, string>): NutrientMap {
  const out: NutrientMap = {};
  const entries = Object.entries(values);
  for (const def of NUTRIENTS) {
    if (!def.ciqual) continue;
    const hit = entries.find(([k]) => def.ciqual!.test(k));
    if (!hit) continue;
    const v = parseCiqualValue(hit[1]);
    if (v != null) out[def.code] = v;
  }
  // Vitamin A (RAE) = retinol + beta-carotene/12
  if (out.vit_a == null && (out.retinol != null || out.beta_carotene != null)) {
    out.vit_a = (out.retinol ?? 0) + (out.beta_carotene ?? 0) / 12;
  }
  return completeDerived(out);
}

export function normalizeCiqual(row: CiqualRow): FoodInput {
  const nutrients = ciqualNutrients(row.values);
  const group = (row.group ?? "").toLowerCase();
  const kind: FoodInput["kind"] = /alcool|vin|bière/.test(group) ? "alcohol" : /boisson|eau/.test(group) ? "drink" : "food";
  return {
    source: "ciqual",
    sourceId: row.code,
    barcode: null,
    kind,
    name: row.nameEs || row.nameEn || row.nameFr,
    nameEs: row.nameEs ?? null,
    brand: null,
    quantityLabel: null,
    imageUrl: null,
    nutrients,
    density: 1,
    nutriscore: null,
    nova: null,
    ecoscore: null,
    additives: [],
    allergens: [],
    traces: [],
    categories: row.group ? [`ciqual:${row.group}`] : [],
    labels: [],
    ingredientsText: null,
    countries: [],
    completeness: Object.keys(nutrients).length / 40,
    servings: [],
  };
}
