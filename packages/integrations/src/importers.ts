/**
 * Diary importers: MyFitnessPal, Lose It!, Cronometer, Waistline and generic CSV.
 * Each maps rows → ImportedEntry (meal-level or food-level) and ImportedWeight.
 */
import { completeDerived, type NutrientMap } from "@nutria/nutrition";

export function parseCsv(text: string, delimiter?: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.indexOf("\n") >>> 0 || src.length);
  const d = delimiter ?? (firstLine.split(";").length > firstLine.split(",").length ? ";" : firstLine.includes("\t") ? "\t" : ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (q) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === d) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (!header) return [];
  const h = header.map((x) => x.trim());
  return data.map((r) => Object.fromEntries(h.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export interface ImportedEntry {
  date: string;
  mealSlot: string;
  name: string;
  grams: number | null;
  servingLabel: string | null;
  nutrients: NutrientMap;
  quick: boolean;
}
export interface ImportedWeight {
  date: string;
  kg: number;
}
export interface ImportResult {
  source: string;
  entries: ImportedEntry[];
  weights: ImportedWeight[];
  skipped: number;
}

const num = (v: string | undefined) => {
  if (v == null || v === "") return undefined;
  const n = Number(v.replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, ".").replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

export function normalizeDate(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // MM/DD/YYYY (MFP/Lose It US) or DD/MM/YYYY
  if (m) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (a > 12) [a, b] = [b, a]; // was DD/MM
    return `${y}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
  }
  return null;
}

export function mealSlotFrom(v: string | undefined): string {
  const s = (v ?? "").toLowerCase();
  if (/break|desay/.test(s)) return "breakfast";
  if (/lunch|almuer|comida/.test(s)) return "lunch";
  if (/dinner|cena|supper/.test(s)) return "dinner";
  if (/snack|merien|tentem|aperitivo/.test(s)) return "afternoon_snack";
  return "afternoon_snack";
}

/** Column aliases → nutrient code (values already in our units unless noted). */
const COLS: [RegExp, string, number?][] = [
  [/^(calories|energy \(kcal\)|energía \(kcal\)|kcal|energy)$/i, "energy_kcal"],
  [/^(protein|proteins?) ?\(g\)$|^protein$/i, "protein"],
  [/^(carbohydrates|carbs|net carbs)? ?\(g\)$|^carbohydrates$|^carbs \(g\)$/i, "carbs"],
  [/^(fat|total fat) ?\(g\)$|^fat$/i, "fat"],
  [/^saturated( fat)? ?\(g\)$|^saturated fat$/i, "sat_fat"],
  [/^polyunsaturated( fat)? ?\(g\)$|^polyunsaturated fat$/i, "poly_fat"],
  [/^monounsaturated( fat)? ?\(g\)$|^monounsaturated fat$/i, "mono_fat"],
  [/^trans( fat)? ?\(g\)$|^trans fat$/i, "trans_fat"],
  [/^(fiber|fibre) ?\(g\)$|^fiber$/i, "fiber"],
  [/^(sugars?) ?\(g\)$|^sugar$/i, "sugars"],
  [/^cholesterol ?\(mg\)$|^cholesterol$/i, "cholesterol"],
  [/^sodium ?\(mg\)$|^sodium$/i, "sodium"],
  [/^potassium ?\(mg\)$|^potassium$/i, "potassium"],
  [/^calcium ?\(mg\)$/i, "calcium"],
  [/^iron ?\(mg\)$/i, "iron"],
  [/^magnesium ?\(mg\)$/i, "magnesium"],
  [/^zinc ?\(mg\)$/i, "zinc"],
  [/^vitamin c ?\(mg\)$/i, "vit_c"],
  [/^vitamin d ?\(µg\)$|^vitamin d \(ug\)$|^vitamin d \(mcg\)$/i, "vit_d"],
  [/^vitamin d ?\(iu\)$/i, "vit_d", 0.025],
  [/^b12 \(cobalamin\) ?\(µg\)$|^vitamin b12 ?\(µg\)$|^b12 ?\(µg\)$/i, "vit_b12"],
  [/^folate ?\(µg\)$|^b9 \(folate\) ?\(µg\)$/i, "folate"],
  [/^vitamin a ?\(µg\)$/i, "vit_a"],
  [/^caffeine ?\(mg\)$/i, "caffeine"],
  [/^alcohol ?\(g\)$/i, "alcohol"],
  [/^omega-3 ?\(g\)$/i, "omega3"],
  [/^selenium ?\(µg\)$/i, "selenium"],
  [/^iodine ?\(µg\)$/i, "iodine"],
];

function rowNutrients(row: Record<string, string>): NutrientMap {
  const out: NutrientMap = {};
  for (const [k, v] of Object.entries(row)) {
    const hit = COLS.find(([re]) => re.test(k.trim()));
    if (!hit) continue;
    const n = num(v);
    if (n != null) out[hit[1]] = n * (hit[2] ?? 1);
  }
  return completeDerived(out);
}

export function detectSource(rows: Record<string, string>[]): "mfp" | "loseit" | "cronometer" | "waistline" | "generic" {
  const h = Object.keys(rows[0] ?? {}).map((x) => x.toLowerCase());
  if (h.includes("food name") && h.includes("day")) return "cronometer";
  if (h.includes("meal") && h.includes("calories") && h.some((x) => x.includes("fat (g)")) && !h.includes("name")) return "mfp";
  if (h.includes("type") && h.includes("name") && h.includes("calories")) return "loseit";
  if (h.includes("meal") && h.includes("name") && (h.includes("brand") || h.includes("portion"))) return "waistline";
  return "generic";
}

export function importDiaryCsv(text: string): ImportResult {
  const rows = parseCsv(text);
  const source = detectSource(rows);
  const entries: ImportedEntry[] = [];
  const weights: ImportedWeight[] = [];
  let skipped = 0;
  for (const r of rows) {
    const get = (...names: string[]) => names.map((n) => Object.entries(r).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1]).find((v) => v != null && v !== "");
    const date = normalizeDate(get("date", "day", "fecha") ?? "");
    if (!date) {
      skipped++;
      continue;
    }
    const weight = num(get("weight", "weight (kg)", "peso"));
    if (weight != null && !get("calories", "energy (kcal)")) {
      weights.push({ date, kg: /lb/i.test(Object.keys(r).join(" ")) ? weight * 0.4536 : weight });
      continue;
    }
    const type = get("type", "meal", "group", "comida");
    if (type && /exercise|ejercicio/i.test(type)) {
      skipped++;
      continue;
    }
    const nutrients = rowNutrients(r);
    if (nutrients.energy_kcal == null) {
      skipped++;
      continue;
    }
    const name = get("food name", "name", "description", "alimento") ?? (source === "mfp" ? `${type ?? "Comida"} (MyFitnessPal)` : "Importado");
    const qty = get("amount", "quantity", "cantidad", "portion");
    const units = get("units", "unit", "unidad");
    const grams = units && /^g|gram/i.test(units) ? (num(qty) ?? null) : (qty?.match(/([\d.,]+)\s*g\b/i) ? num(qty.match(/([\d.,]+)\s*g\b/i)![1]) ?? null : null);
    entries.push({
      date,
      mealSlot: mealSlotFrom(type),
      name,
      grams,
      servingLabel: qty ? [qty, units].filter(Boolean).join(" ") : null,
      nutrients,
      quick: source === "mfp" || grams == null,
    });
  }
  return { source, entries, weights, skipped };
}
