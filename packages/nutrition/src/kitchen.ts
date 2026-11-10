/**
 * M12/M13 kitchen logic: Spanish ingredient parsing, recipe nutrition & scaling,
 * family portions, shopping list aggregation (plan − pantry), batch consumption.
 */
import { scaleNutrients, sumNutrients, type NutrientMap } from "./totals";

/* ------------------------------ Ingredient parsing ----------------------------- */

const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
const WORD_NUMBERS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  medio: 0.5, media: 0.5, "un par de": 2, docena: 12,
};

/** Unit → grams (approximate for volume/household units; water density). */
export const UNIT_GRAMS: Record<string, number> = {
  g: 1, gr: 1, gramo: 1, gramos: 1, kg: 1000, kilo: 1000, kilos: 1000, mg: 0.001,
  ml: 1, cl: 10, dl: 100, l: 1000, litro: 1000, litros: 1000,
  cucharada: 15, cucharadas: 15, cda: 15, cdas: 15, "c/s": 15,
  cucharadita: 5, cucharaditas: 5, cdta: 5, cdtas: 5, "c/c": 5,
  taza: 240, tazas: 240, vaso: 200, vasos: 200,
  pizca: 0.5, pizcas: 0.5, chorro: 10, chorrito: 5, puñado: 30, puñados: 30,
  diente: 5, dientes: 5, loncha: 20, lonchas: 20, rebanada: 30, rebanadas: 30,
  lata: 400, latas: 400, sobre: 10, sobres: 10, ramita: 2, ramitas: 2, hoja: 1, hojas: 1,
};

/** Typical unit weights for countable items (grams per piece). */
export const PIECE_GRAMS: Record<string, number> = {
  huevo: 55, huevos: 55, cebolla: 150, cebollas: 150, tomate: 120, tomates: 120, patata: 170, patatas: 170,
  zanahoria: 70, zanahorias: 70, ajo: 5, limón: 100, limones: 100, naranja: 180, naranjas: 180,
  manzana: 180, manzanas: 180, plátano: 120, plátanos: 120, pimiento: 160, pimientos: 160,
  calabacín: 250, berenjena: 300, aguacate: 170, pepino: 250, puerro: 120, yogur: 125, yogures: 125,
  "pechuga de pollo": 200, pechuga: 200, pechugas: 200, filete: 150, filetes: 150, lata: 400,
};

export interface ParsedIngredient {
  raw: string;
  quantity: number | null;
  unit: string | null;
  name: string;
  grams: number | null;
  optional: boolean;
}

function parseNumber(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (FRACTIONS[t] != null) return FRACTIONS[t]!;
  if (WORD_NUMBERS[t] != null) return WORD_NUMBERS[t]!;
  const mixed = t.match(/^(\d+)\s*([½¼¾⅓⅔⅛])$/);
  if (mixed) return Number(mixed[1]) + FRACTIONS[mixed[2]!]!;
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const range = t.match(/^(\d+(?:[.,]\d+)?)\s*[-–a]\s*(\d+(?:[.,]\d+)?)$/);
  if (range) return (Number(range[1]!.replace(",", ".")) + Number(range[2]!.replace(",", "."))) / 2;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const NUM_RE = String.raw`(\d+\s*[½¼¾⅓⅔⅛]|\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?|\d+\s*/\s*\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔⅛]|un par de|una|uno|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|media|medio)`;
const UNIT_RE = String.raw`(kg|kilos?|gr|gramos?|g|mg|ml|cl|dl|litros?|l|cucharaditas?|cucharadas?|cdtas?|cdas?|c\/s|c\/c|tazas?|vasos?|pizcas?|chorrito|chorro|puñados?|dientes?|lonchas?|rebanadas?|latas?|sobres?|ramitas?|hojas?)\b\.?`;

export function parseIngredient(raw: string): ParsedIngredient {
  let text = raw.trim().replace(/\s+/g, " ");
  const optional = /\(opcional\)|opcional|al gusto/i.test(text);
  text = text.replace(/\(opcional\)/i, "").trim();
  const re = new RegExp(`^${NUM_RE}\\s*(?:${UNIT_RE})?\\s*(?:de\\s+)?(.*)$`, "i");
  const m = text.match(re);
  let quantity: number | null = null;
  let unit: string | null = null;
  let name = text;
  if (m) {
    quantity = parseNumber(m[1]!);
    unit = m[2]?.toLowerCase().replace(/\.$/, "") ?? null;
    name = (m[3] ?? "").trim();
  }
  // "sal al gusto", "aceite"
  name = name.replace(/,.*$/, "").replace(/\bal gusto\b/i, "").trim();
  let grams: number | null = null;
  if (quantity != null && unit && UNIT_GRAMS[unit] != null) grams = quantity * UNIT_GRAMS[unit]!;
  else if (quantity != null && !unit) {
    const key = Object.keys(PIECE_GRAMS)
      .sort((a, b) => b.length - a.length)
      .find((k) => name.toLowerCase().startsWith(k));
    if (key) grams = quantity * PIECE_GRAMS[key]!;
  }
  // "200 g de garbanzos (cocidos)" keep parenthetical in name
  const gramsInParens = raw.match(/\((\d+(?:[.,]\d+)?)\s*(g|gr|ml)\)/i);
  if (gramsInParens) grams = Number(gramsInParens[1]!.replace(",", "."));
  return { raw, quantity, unit, name: name || raw, grams: grams == null ? null : Math.round(grams * 10) / 10, optional };
}

/** Normalized key for matching ingredients across recipes / pantry ("Cebollas rojas" → "cebolla roja"). */
export function ingredientKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\b(fresc[oa]s?|picad[oa]s?|troceado?s?|en dados|en rodajas|grandes?|pequeñ[oa]s?|medianas?|maduros?|cocid[oa]s?|crud[oa]s?)\b/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 4 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ")
    .trim();
}

/* ------------------------------- Recipe nutrition ------------------------------ */

export interface RecipeIngredientInput {
  grams: number | null;
  per100?: NutrientMap | null; // food nutrients per 100 g
  optional?: boolean;
  pricePerKg?: number | null;
}

export interface RecipeNutrition {
  total: NutrientMap;
  perServing: NutrientMap;
  per100: NutrientMap;
  rawWeight: number;
  missing: number; // ingredients without grams or nutrients
  costTotal: number | null;
  costPerServing: number | null;
}

export function recipeNutrition(ings: RecipeIngredientInput[], servings: number, cookedWeight?: number | null): RecipeNutrition {
  let missing = 0;
  let cost = 0;
  let costKnown = true;
  const parts: NutrientMap[] = [];
  let raw = 0;
  for (const i of ings) {
    if (i.optional) continue;
    if (i.grams == null || !i.per100) {
      missing++;
      continue;
    }
    parts.push(scaleNutrients(i.per100, i.grams));
    raw += i.grams;
    if (i.pricePerKg != null) cost += (i.pricePerKg * i.grams) / 1000;
    else costKnown = false;
  }
  const total = sumNutrients(parts);
  const s = Math.max(servings, 0.0001);
  const perServing = Object.fromEntries(Object.entries(total).map(([k, v]) => [k, v / s]));
  const weight = cookedWeight && cookedWeight > 0 ? cookedWeight : raw;
  const per100 = weight > 0 ? Object.fromEntries(Object.entries(total).map(([k, v]) => [k, (v / weight) * 100])) : {};
  return {
    total,
    perServing,
    per100,
    rawWeight: raw,
    missing,
    costTotal: costKnown && parts.length ? Math.round(cost * 100) / 100 : null,
    costPerServing: costKnown && parts.length ? Math.round((cost / s) * 100) / 100 : null,
  };
}

export function scaleRecipe<T extends { grams: number | null; quantity?: number | null }>(ings: T[], fromServings: number, toServings: number): T[] {
  const f = toServings / fromServings;
  return ings.map((i) => ({
    ...i,
    grams: i.grams == null ? null : Math.round(i.grams * f * 10) / 10,
    quantity: i.quantity == null ? i.quantity : Math.round(i.quantity * f * 100) / 100,
  }));
}

/* -------------------------------- Family portions ------------------------------ */

export interface FamilyMember {
  personId: string;
  dailyKcal: number;
  /** Share of daily kcal for this meal slot (e.g. lunch 0.35). */
  slotShare: number;
}

/**
 * Split a shared dish between people proportionally to each person's kcal budget for the meal.
 * Returns servings per person (based on kcal per serving) rounded to 0.25.
 */
export function familyPortions(members: FamilyMember[], kcalPerServing: number, dishShareOfMeal = 0.8): Record<string, { servings: number; kcal: number }> {
  const out: Record<string, { servings: number; kcal: number }> = {};
  for (const m of members) {
    const mealKcal = m.dailyKcal * m.slotShare * dishShareOfMeal;
    const servings = kcalPerServing > 0 ? Math.max(0.25, Math.round((mealKcal / kcalPerServing) * 4) / 4) : 1;
    out[m.personId] = { servings, kcal: Math.round(servings * kcalPerServing) };
  }
  return out;
}

export const DEFAULT_SLOT_SHARES: Record<string, number> = {
  breakfast: 0.22,
  morning_snack: 0.08,
  lunch: 0.35,
  afternoon_snack: 0.1,
  dinner: 0.25,
};

/* ------------------------------- Shopping list --------------------------------- */

export interface NeedItem {
  key: string; // ingredientKey
  name: string;
  grams: number | null;
  quantity?: number | null;
  unit?: string | null;
  foodId?: string | null;
  category?: string | null;
  recipeId?: string | null;
}

export interface PantryStock {
  key: string;
  grams: number | null; // null = present, unknown amount
  staple?: boolean;
}

export interface ShoppingLine {
  key: string;
  name: string;
  grams: number | null;
  quantity: number | null;
  unit: string | null;
  foodId: string | null;
  category: string;
  fromRecipes: string[];
}

/** Aggregate needs from all planned meals and subtract pantry stock. */
export function aggregateShopping(needs: NeedItem[], pantry: PantryStock[] = []): ShoppingLine[] {
  const byKey = new Map<string, ShoppingLine>();
  for (const n of needs) {
    const cur = byKey.get(n.key);
    if (!cur) {
      byKey.set(n.key, {
        key: n.key,
        name: n.name,
        grams: n.grams,
        quantity: n.grams == null ? (n.quantity ?? null) : null,
        unit: n.grams == null ? (n.unit ?? null) : "g",
        foodId: n.foodId ?? null,
        category: n.category ?? guessCategory(n.name),
        fromRecipes: n.recipeId ? [n.recipeId] : [],
      });
    } else {
      if (n.grams != null) cur.grams = (cur.grams ?? 0) + n.grams;
      else if (n.quantity != null) cur.quantity = (cur.quantity ?? 0) + n.quantity;
      if (n.recipeId && !cur.fromRecipes.includes(n.recipeId)) cur.fromRecipes.push(n.recipeId);
      cur.foodId ??= n.foodId ?? null;
    }
  }
  const out: ShoppingLine[] = [];
  for (const line of byKey.values()) {
    const stock = pantry.find((p) => p.key === line.key);
    if (stock) {
      if (stock.staple || stock.grams == null) continue;
      if (line.grams != null) {
        const left = line.grams - stock.grams;
        if (left <= 0) continue;
        line.grams = Math.round(left);
      }
    }
    if (line.grams != null) line.grams = Math.round(line.grams);
    out.push(line);
  }
  return out.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name, "es"));
}

export const CATEGORY_ORDER = ["fruta_verdura", "carne", "pescado", "lacteos_huevos", "panaderia", "despensa", "congelados", "bebidas", "limpieza", "otros"];
export const CATEGORY_NAMES: Record<string, string> = {
  fruta_verdura: "Fruta y verdura",
  carne: "Carne",
  pescado: "Pescado y marisco",
  lacteos_huevos: "Lácteos y huevos",
  panaderia: "Panadería",
  despensa: "Despensa",
  congelados: "Congelados",
  bebidas: "Bebidas",
  limpieza: "Limpieza",
  otros: "Otros",
};

export function guessCategory(name: string): string {
  const s = name.toLowerCase();
  if (/(tomate|cebolla|ajo|lechuga|pimiento|zanahoria|patata|calabac|berenjena|espinaca|br[óo]coli|coliflor|manzana|pl[áa]tano|naranja|lim[óo]n|fresa|uva|pera|aguacate|pepino|puerro|champi|perejil|cilantro|albahaca|fruta|verdura|lechuga|kiwi|mel[óo]n|sand[íi]a)/.test(s)) return "fruta_verdura";
  if (/(pollo|ternera|cerdo|cordero|pavo|carne|jam[óo]n|chorizo|lomo|bacon|beicon|salchicha|hamburguesa)/.test(s)) return "carne";
  if (/(merluza|salm[óo]n|at[úu]n|bacalao|gamba|langostino|mejill|calamar|sardina|pescado|dorada|lubina|boquer)/.test(s)) return "pescado";
  if (/(leche|yogur|queso|nata|mantequilla|huevo|k[ée]fir|reques)/.test(s)) return "lacteos_huevos";
  if (/(pan\b|baguette|tortilla de trigo|picos|biscote)/.test(s)) return "panaderia";
  if (/(congelad)/.test(s)) return "congelados";
  if (/(agua|zumo|refresco|cerveza|vino|caf[ée]|t[ée]\b|infusi)/.test(s)) return "bebidas";
  if (/(arroz|pasta|harina|aceite|sal\b|az[úu]car|lenteja|garbanzo|alubia|jud[íi]a|especia|pimienta|or[ée]gano|comino|vinagre|tomate frito|caldo|avena|frutos secos|nuez|almendra|conserva|legumbre|quinoa|cusc[úu]s)/.test(s)) return "despensa";
  return "otros";
}

/* -------------------------------- Pantry dates --------------------------------- */

/** Grocy-style date shorthands: "+1m", "+10d", "+2w", "MMDD", "YYYYMMDD", "YYYYMMe" (end of month), "x" (never). */
export function parseDateShorthand(input: string, today: Date = new Date()): string | null | "never" {
  const s = input.trim().toLowerCase();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const base = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 12));
  if (s === "x") return "never";
  let m = s.match(/^\+(\d+)\s*([dwmy])$/);
  if (m) {
    const n = Number(m[1]);
    const d = new Date(base);
    if (m[2] === "d") d.setUTCDate(d.getUTCDate() + n);
    if (m[2] === "w") d.setUTCDate(d.getUTCDate() + 7 * n);
    if (m[2] === "m") d.setUTCMonth(d.getUTCMonth() + n);
    if (m[2] === "y") d.setUTCFullYear(d.getUTCFullYear() + n);
    return iso(d);
  }
  m = s.match(/^(\d{4})(\d{2})e$/);
  if (m) return iso(new Date(Date.UTC(Number(m[1]), Number(m[2]), 0, 12)));
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})(\d{2})$/);
  if (m) {
    let year = base.getUTCFullYear();
    const candidate = new Date(Date.UTC(year, Number(m[1]) - 1, Number(m[2]), 12));
    if (candidate < base) year++;
    return iso(new Date(Date.UTC(year, Number(m[1]) - 1, Number(m[2]), 12)));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

export function expiryStatus(expiresOn: string | null, today: string): "expired" | "soon" | "ok" | "none" {
  if (!expiresOn) return "none";
  const d = (Date.parse(expiresOn) - Date.parse(today)) / 86_400_000;
  if (d < 0) return "expired";
  if (d <= 3) return "soon";
  return "ok";
}

/* ------------------------- Plan coverage & batch cooking ------------------------ */

export interface PlanDish {
  date: string;
  recipeId: string | null;
  title: string;
  /** Servings of this person. */
  servings: number;
  kcalPerServing: number | null;
  proteinPerServing: number | null;
}

export type CoverageStatus = "empty" | "partial" | "short" | "ok";
export interface PlanCoverageDay {
  date: string;
  kcal: number;
  protein: number;
  targetKcal: number | null;
  targetProtein: number | null;
  dishes: number;
  /** Dishes without nutrition (free text): the totals are a lower bound. */
  unknown: number;
  status: CoverageStatus;
}

/**
 * What the planned dishes give one person each day against that day's target (training or rest).
 * "short" = at least two dishes with known nutrition and under 85 % of kcal or protein.
 */
export function planCoverage(dates: string[], dishes: PlanDish[], targets: Record<string, { kcal: number; protein: number } | null | undefined>): PlanCoverageDay[] {
  return dates.map((date) => {
    const day = dishes.filter((d) => d.date === date && d.servings > 0);
    const known = day.filter((d) => d.kcalPerServing != null);
    const kcal = Math.round(known.reduce((a, d) => a + d.servings * d.kcalPerServing!, 0));
    const protein = Math.round(known.reduce((a, d) => a + d.servings * (d.proteinPerServing ?? 0), 0));
    const t = targets[date] ?? null;
    const unknown = day.length - known.length;
    let status: CoverageStatus = "empty";
    if (day.length) {
      const enough = !!t && kcal >= t.kcal * 0.85 && protein >= t.protein * 0.85;
      status = enough ? "ok" : known.length >= 2 && !unknown && t ? "short" : "partial";
    }
    return { date, kcal, protein, targetKcal: t ? Math.round(t.kcal) : null, targetProtein: t ? Math.round(t.protein) : null, dishes: day.length, unknown, status };
  });
}

export interface BatchSuggestion {
  recipeId: string;
  title: string;
  /** Total servings of the household for the week. */
  servings: number;
  dates: string[];
  /** Days between the first and the last time it is eaten. */
  spanDays: number;
  /** fridge = keeps in the fridge for the whole span; freeze = freeze the later portions; split = cook twice. */
  storage: "fridge" | "freeze" | "split";
}

/** Recipes planned on two or more days: cook once (the first day) for the whole week. */
export function batchSuggestions(items: { recipeId: string | null; title: string; date: string; servings: number }[], recipes: Record<string, { fridgeDays: number | null; freezable: boolean } | undefined>): BatchSuggestion[] {
  const by = new Map<string, { title: string; servings: number; dates: Set<string> }>();
  for (const i of items) {
    if (!i.recipeId) continue;
    const cur = by.get(i.recipeId) ?? { title: i.title, servings: 0, dates: new Set<string>() };
    cur.servings += i.servings;
    cur.dates.add(i.date);
    by.set(i.recipeId, cur);
  }
  const out: BatchSuggestion[] = [];
  for (const [recipeId, v] of by) {
    if (v.dates.size < 2) continue;
    const dates = [...v.dates].sort();
    const spanDays = Math.round((Date.parse(dates.at(-1)!) - Date.parse(dates[0]!)) / 86_400_000);
    const r = recipes[recipeId];
    const storage = spanDays <= (r?.fridgeDays ?? 3) ? "fridge" : r?.freezable ? "freeze" : "split";
    out.push({ recipeId, title: v.title, servings: Math.round(v.servings * 4) / 4, dates, spanDays, storage });
  }
  return out.sort((a, b) => a.dates[0]!.localeCompare(b.dates[0]!) || b.servings - a.servings);
}
