/**
 * M4 drug–food interactions (curated table, see seed) and supplement UL warnings (M3).
 */
import { NUTRIENT_BY_CODE } from "./nutrients";
import type { NutrientMap } from "./totals";

export interface Interaction {
  substanceCode: string;
  substanceNameEs: string;
  matchType: "nutrient" | "category" | "keyword" | "timing";
  matchValue: string; // nutrient code[:threshold], category tag, regex source, timing rule
  severity: "info" | "caution" | "avoid";
  messageEs: string;
  source: string;
}

export interface InteractionFood {
  name: string;
  nutrients: NutrientMap;
  categories?: string[];
  ingredientsText?: string | null;
}

export interface InteractionHit {
  medication: string;
  severity: Interaction["severity"];
  message: string;
  source: string;
}

export function checkInteractions(
  food: InteractionFood,
  meds: { name: string; substanceCode: string | null }[],
  table: Interaction[],
): InteractionHit[] {
  const text = `${food.name} ${food.ingredientsText ?? ""}`.toLowerCase();
  const hits: InteractionHit[] = [];
  for (const med of meds) {
    if (!med.substanceCode) continue;
    for (const it of table.filter((r) => r.substanceCode === med.substanceCode)) {
      let match = false;
      if (it.matchType === "nutrient") {
        const [code, thr] = it.matchValue.split(":");
        match = (food.nutrients[code!] ?? 0) > Number(thr ?? 0);
      } else if (it.matchType === "category") match = (food.categories ?? []).includes(it.matchValue);
      else if (it.matchType === "keyword") match = new RegExp(it.matchValue, "i").test(text);
      if (match) hits.push({ medication: med.name, severity: it.severity, message: it.messageEs, source: it.source });
    }
  }
  return hits;
}

/** Timing rules for a medication (e.g. levothyroxine on an empty stomach). */
export function timingRules(substanceCode: string, table: Interaction[]): string[] {
  return table.filter((r) => r.substanceCode === substanceCode && r.matchType === "timing").map((r) => r.messageEs);
}

/** Warn when daily totals (food + supplements) exceed the adult UL. */
export function ulWarnings(totals: NutrientMap, limits: Record<string, { max?: number }>): { code: string; nameEs: string; amount: number; max: number }[] {
  const out: { code: string; nameEs: string; amount: number; max: number }[] = [];
  for (const [code, lim] of Object.entries(limits)) {
    if (lim.max == null || totals[code] == null) continue;
    if (totals[code]! > lim.max) out.push({ code, nameEs: NUTRIENT_BY_CODE[code]?.nameEs ?? code, amount: totals[code]!, max: lim.max });
  }
  return out;
}

/** Curated seed table. Sources: AEMPS fichas técnicas, Stockley's, Natural Medicines summaries. */
export const DRUG_FOOD_INTERACTIONS: Interaction[] = [
  { substanceCode: "warfarin", substanceNameEs: "Acenocumarol / warfarina", matchType: "nutrient", matchValue: "vit_k:100", severity: "caution", messageEs: "Alto en vitamina K: con anticoagulantes antivitamina K mantén una ingesta de vitamina K estable día a día (no evitarla, sino no cambiarla bruscamente).", source: "AEMPS ficha técnica Sintrom" },
  { substanceCode: "warfarin", substanceNameEs: "Acenocumarol / warfarina", matchType: "keyword", matchValue: "pomelo|ar[áa]ndano rojo|cranberry|ginkgo|hip[ée]rico", severity: "caution", messageEs: "Puede modificar el efecto del anticoagulante. Consulta con tu médico.", source: "Stockley's Drug Interactions" },
  { substanceCode: "maoi", substanceNameEs: "IMAO", matchType: "keyword", matchValue: "queso curado|queso azul|parmesano|embutido curado|salami|chorizo|salchich[óo]n|soja fermentada|miso|salsa de soja|chucrut|kimchi|levadura|marmite|habas|cerveza de barril|vino tinto", severity: "avoid", messageEs: "Alimento rico en tiramina: con IMAO puede causar crisis hipertensiva.", source: "AEMPS / Stockley's" },
  { substanceCode: "levothyroxine", substanceNameEs: "Levotiroxina", matchType: "timing", matchValue: "fasting", severity: "info", messageEs: "Tómala en ayunas con agua, 30–60 minutos antes del desayuno.", source: "AEMPS ficha técnica Eutirox" },
  { substanceCode: "levothyroxine", substanceNameEs: "Levotiroxina", matchType: "nutrient", matchValue: "calcium:300", severity: "caution", messageEs: "El calcio reduce su absorción: separa 4 horas de lácteos ricos en calcio y suplementos de calcio o hierro.", source: "AEMPS ficha técnica Eutirox" },
  { substanceCode: "levothyroxine", substanceNameEs: "Levotiroxina", matchType: "keyword", matchValue: "caf[ée]|soja|pomelo", severity: "info", messageEs: "El café, la soja y el pomelo pueden reducir su absorción: espera al menos 30–60 minutos.", source: "AEMPS ficha técnica" },
  { substanceCode: "statin_cyp3a4", substanceNameEs: "Simvastatina / atorvastatina / lovastatina", matchType: "keyword", matchValue: "pomelo|grapefruit", severity: "avoid", messageEs: "El pomelo aumenta los niveles de la estatina (riesgo muscular). Evítalo.", source: "AEMPS ficha técnica simvastatina" },
  { substanceCode: "calcium_channel", substanceNameEs: "Antagonistas del calcio (felodipino, nifedipino…)", matchType: "keyword", matchValue: "pomelo|grapefruit", severity: "avoid", messageEs: "El pomelo potencia el fármaco (hipotensión). Evítalo.", source: "Stockley's" },
  { substanceCode: "lithium", substanceNameEs: "Litio", matchType: "nutrient", matchValue: "sodium:1000", severity: "caution", messageEs: "Cambios bruscos de sal alteran los niveles de litio: mantén una ingesta de sal e hidratación estables.", source: "AEMPS ficha técnica Plenur" },
  { substanceCode: "lithium", substanceNameEs: "Litio", matchType: "nutrient", matchValue: "caffeine:150", severity: "info", messageEs: "La cafeína puede reducir los niveles de litio; evita cambios bruscos de consumo.", source: "Stockley's" },
  { substanceCode: "tetracycline", substanceNameEs: "Tetraciclinas / quinolonas", matchType: "nutrient", matchValue: "calcium:150", severity: "caution", messageEs: "Lácteos, calcio, hierro y magnesio reducen su absorción: separa 2–3 horas.", source: "AEMPS fichas técnicas doxiciclina/ciprofloxacino" },
  { substanceCode: "ace_inhibitor", substanceNameEs: "IECA / ARA-II / espironolactona", matchType: "nutrient", matchValue: "potassium:800", severity: "caution", messageEs: "Muy alto en potasio: con este fármaco puede subir el potasio en sangre. Evita sustitutos de sal con potasio.", source: "AEMPS fichas técnicas enalapril/espironolactona" },
  { substanceCode: "ace_inhibitor", substanceNameEs: "IECA / ARA-II / espironolactona", matchType: "keyword", matchValue: "sal (baja en sodio|con potasio)|cloruro pot[áa]sico", severity: "avoid", messageEs: "Los sustitutos de sal con potasio pueden causar hiperpotasemia con este fármaco.", source: "AEMPS" },
  { substanceCode: "metformin", substanceNameEs: "Metformina", matchType: "nutrient", matchValue: "alcohol:20", severity: "caution", messageEs: "El alcohol aumenta el riesgo de acidosis láctica e hipoglucemia con metformina.", source: "AEMPS ficha técnica Dianben" },
  { substanceCode: "metformin", substanceNameEs: "Metformina", matchType: "timing", matchValue: "with_food", severity: "info", messageEs: "Tómala con las comidas para reducir molestias digestivas. A largo plazo vigila la B12.", source: "AEMPS ficha técnica" },
  { substanceCode: "insulin_sulfonylurea", substanceNameEs: "Insulina / sulfonilureas", matchType: "nutrient", matchValue: "alcohol:10", severity: "caution", messageEs: "El alcohol puede causar hipoglucemias tardías. Tómalo con comida y controla la glucosa.", source: "AEMPS" },
  { substanceCode: "iron_supplement", substanceNameEs: "Suplemento de hierro", matchType: "nutrient", matchValue: "calcium:250", severity: "info", messageEs: "El calcio, el té y el café reducen la absorción de hierro; la vitamina C la mejora.", source: "EFSA / AEMPS" },
  { substanceCode: "iron_supplement", substanceNameEs: "Suplemento de hierro", matchType: "keyword", matchValue: "\\bt[ée]\\b|caf[ée]", severity: "info", messageEs: "Separa el hierro del té o café al menos 1 hora.", source: "AEMPS" },
  { substanceCode: "bisphosphonate", substanceNameEs: "Alendronato / bifosfonatos", matchType: "timing", matchValue: "fasting", severity: "info", messageEs: "En ayunas, con un vaso de agua y sin tumbarte; espera 30 minutos antes de comer o beber otra cosa.", source: "AEMPS ficha técnica Fosamax" },
  { substanceCode: "methotrexate", substanceNameEs: "Metotrexato", matchType: "nutrient", matchValue: "alcohol:5", severity: "avoid", messageEs: "Evita el alcohol con metotrexato (hepatotoxicidad).", source: "AEMPS ficha técnica" },
  { substanceCode: "linezolid", substanceNameEs: "Linezolid", matchType: "keyword", matchValue: "queso curado|embutido curado|salsa de soja|chucrut|vino tinto|cerveza de barril", severity: "caution", messageEs: "Evita grandes cantidades de alimentos ricos en tiramina.", source: "AEMPS ficha técnica Zyvoxid" },
];

export const MEDICATION_SUBSTANCES: { code: string; nameEs: string; keywords: RegExp }[] = [
  { code: "warfarin", nameEs: "Anticoagulante antivitamina K", keywords: /sintrom|acenocumarol|warfarin|aldocumar/i },
  { code: "maoi", nameEs: "IMAO", keywords: /fenelzina|tranilcipromina|selegilina|rasagilina|moclobemida|nardil/i },
  { code: "levothyroxine", nameEs: "Levotiroxina", keywords: /levotiroxina|eutirox|levothroid|thyrax/i },
  { code: "statin_cyp3a4", nameEs: "Estatina (CYP3A4)", keywords: /simvastatina|atorvastatina|lovastatina|zocor|cardyl|lipitor/i },
  { code: "calcium_channel", nameEs: "Antagonista del calcio", keywords: /felodipino|nifedipino|amlodipino|nisoldipino|lercanidipino/i },
  { code: "lithium", nameEs: "Litio", keywords: /litio|plenur/i },
  { code: "tetracycline", nameEs: "Tetraciclina / quinolona", keywords: /doxiciclina|tetraciclina|minociclina|ciprofloxacino|levofloxacino|moxifloxacino/i },
  { code: "ace_inhibitor", nameEs: "IECA / ARA-II / ahorrador de potasio", keywords: /enalapril|ramipril|lisinopril|captopril|losart[aá]n|valsart[aá]n|candesart[aá]n|olmesart[aá]n|irbesart[aá]n|espironolactona|eplerenona|amilorida/i },
  { code: "metformin", nameEs: "Metformina", keywords: /metformina|dianben/i },
  { code: "insulin_sulfonylurea", nameEs: "Insulina / sulfonilurea", keywords: /insulina|glibenclamida|gliclazida|glimepirida|lantus|novorapid|humalog|toujeo|tresiba/i },
  { code: "iron_supplement", nameEs: "Hierro", keywords: /hierro|ferroso|fero-?gradumet|tardyferon/i },
  { code: "bisphosphonate", nameEs: "Bifosfonato", keywords: /alendronato|risedronato|ibandronato|fosamax/i },
  { code: "methotrexate", nameEs: "Metotrexato", keywords: /metotrexato/i },
  { code: "linezolid", nameEs: "Linezolid", keywords: /linezolid|zyvoxid/i },
];

export function detectSubstance(name: string): string | null {
  return MEDICATION_SUBSTANCES.find((s) => s.keywords.test(name))?.code ?? null;
}
