/** M2: food quality — ultra-processed share, daily quality score, allergen alerts, healthier alternatives. */
import type { NutrientMap } from "./totals";

export interface QualityEntry {
  kcal: number;
  nova?: number | null;
  nutriscore?: string | null;
  nutrients?: NutrientMap;
}

/** % of kcal coming from NOVA 4 foods (only entries with known NOVA count in the denominator). */
export function upfKcalPct(entries: QualityEntry[]): number | null {
  const known = entries.filter((e) => e.nova != null && e.kcal > 0);
  const total = known.reduce((s, e) => s + e.kcal, 0);
  if (total === 0) return null;
  const upf = known.filter((e) => e.nova === 4).reduce((s, e) => s + e.kcal, 0);
  return Math.round((upf / total) * 1000) / 10;
}

/** % of the day's kcal whose NOVA group is known (how much `upfKcalPct` can be trusted). */
export function novaCoverage(entries: QualityEntry[]): number | null {
  const total = entries.reduce((s, e) => s + Math.max(0, e.kcal), 0);
  if (total === 0) return null;
  const known = entries.filter((e) => e.nova != null && e.kcal > 0).reduce((s, e) => s + e.kcal, 0);
  return Math.round((known / total) * 1000) / 10;
}

/** Below this NOVA coverage the UPF share describes a few foods, not the day. */
export const NOVA_MIN_COVERAGE = 50;

const NS_POINTS: Record<string, number> = { a: 100, b: 80, c: 55, d: 30, e: 10 };

/**
 * Daily diet quality score 0..100: kcal-weighted Nutri-Score, penalised by UPF share,
 * rewarded for fiber density and penalised for excess sugars/salt/sat fat vs. targets.
 */
export function dailyQualityScore(
  entries: QualityEntry[],
  totals: NutrientMap,
  targets: { kcal: number; fiber?: number; salt?: number; sat_fat?: number; added_sugars?: number },
): number | null {
  const kcalTotal = totals.energy_kcal ?? entries.reduce((s, e) => s + e.kcal, 0);
  if (!kcalTotal) return null;
  const graded = entries.filter((e) => e.nutriscore && NS_POINTS[e.nutriscore] != null && e.kcal > 0);
  const gradedKcal = graded.reduce((s, e) => s + e.kcal, 0);
  let score = gradedKcal > 0 ? graded.reduce((s, e) => s + NS_POINTS[e.nutriscore!]! * e.kcal, 0) / gradedKcal : 60;
  const upf = upfKcalPct(entries);
  // Only penalise UPF when NOVA covers enough of the day; otherwise one known food decides it.
  if (upf != null && (novaCoverage(entries) ?? 0) >= NOVA_MIN_COVERAGE) score -= Math.max(0, upf - 15) * 0.4;
  const fiberDensity = ((totals.fiber ?? 0) / kcalTotal) * 1000; // g/1000 kcal
  score += Math.min(10, Math.max(-10, (fiberDensity - 12) * 1.2));
  const over = (v: number | undefined, max: number | undefined) => (v != null && max ? Math.max(0, v / max - 1) : 0);
  score -= Math.min(15, over(totals.salt, targets.salt) * 20);
  score -= Math.min(10, over(totals.sat_fat, targets.sat_fat) * 15);
  score -= Math.min(10, over(totals.added_sugars ?? totals.sugars, targets.added_sugars) * 10);
  return Math.round(Math.max(0, Math.min(100, score)));
}

/** Map person allergen keywords (es) to OFF allergen tags. */
export const ALLERGEN_TAGS: Record<string, { tag: string; nameEs: string }> = {
  gluten: { tag: "en:gluten", nameEs: "Gluten" },
  leche: { tag: "en:milk", nameEs: "Leche" },
  huevo: { tag: "en:eggs", nameEs: "Huevo" },
  frutos_secos: { tag: "en:nuts", nameEs: "Frutos de cáscara" },
  cacahuete: { tag: "en:peanuts", nameEs: "Cacahuete" },
  soja: { tag: "en:soybeans", nameEs: "Soja" },
  pescado: { tag: "en:fish", nameEs: "Pescado" },
  crustaceos: { tag: "en:crustaceans", nameEs: "Crustáceos" },
  moluscos: { tag: "en:molluscs", nameEs: "Moluscos" },
  apio: { tag: "en:celery", nameEs: "Apio" },
  mostaza: { tag: "en:mustard", nameEs: "Mostaza" },
  sesamo: { tag: "en:sesame-seeds", nameEs: "Sésamo" },
  sulfitos: { tag: "en:sulphur-dioxide-and-sulphites", nameEs: "Sulfitos" },
  altramuces: { tag: "en:lupin", nameEs: "Altramuces" },
};

export interface AllergenAlert {
  allergen: string;
  nameEs: string;
  level: "contains" | "traces";
}

export function allergenAlerts(food: { allergens?: string[]; traces?: string[] }, personAllergens: string[]): AllergenAlert[] {
  const out: AllergenAlert[] = [];
  for (const a of personAllergens) {
    const m = ALLERGEN_TAGS[a];
    if (!m) continue;
    if (food.allergens?.includes(m.tag)) out.push({ allergen: a, nameEs: m.nameEs, level: "contains" });
    else if (food.traces?.includes(m.tag)) out.push({ allergen: a, nameEs: m.nameEs, level: "traces" });
  }
  return out;
}

export interface AltCandidate {
  id: string;
  name: string;
  nutriscore?: string | null;
  nova?: number | null;
  categories: string[];
  kcal?: number | null;
  allergens?: string[];
}

/** Most specific category = last tag in OFF hierarchy. */
export function specificCategory(categories: string[]): string | undefined {
  return categories.filter((c) => c.startsWith("en:")).at(-1);
}

/** Rank healthier alternatives in the same specific category (better Nutri-Score/NOVA). */
export function rankAlternatives(base: AltCandidate, candidates: AltCandidate[], personAllergens: string[] = [], limit = 5): AltCandidate[] {
  const cat = specificCategory(base.categories);
  if (!cat) return [];
  const baseNs = NS_POINTS[base.nutriscore ?? ""] ?? 0;
  const baseNova = base.nova ?? 4;
  return candidates
    .filter((c) => c.id !== base.id && c.categories.includes(cat))
    .filter((c) => allergenAlerts({ allergens: c.allergens }, personAllergens).length === 0)
    .map((c) => {
      const ns = NS_POINTS[c.nutriscore ?? ""] ?? 0;
      const nova = c.nova ?? 4;
      return { c, gain: ns - baseNs + (baseNova - nova) * 12 };
    })
    .filter((x) => x.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, limit)
    .map((x) => x.c);
}
