/** Body measurements and composition: tape and skinfold body-fat estimates, lean/fat mass and FFMI. */
import { daysBetween } from "./tdee-adaptive";

/** Tape sites (cm) with how to measure them: same way, same time (morning, fasted), right side. */
export const MEASURE_SITES = [
  { key: "waist", label: "Cintura", hint: "Punto más estrecho entre ombligo y esternón, al final de una espiración normal, sin meter tripa." },
  { key: "hips", label: "Cadera", hint: "Máxima prominencia de los glúteos, cinta horizontal, pies juntos." },
  { key: "chest", label: "Pecho", hint: "A la altura de los pezones, por las axilas, al final de una espiración normal." },
  { key: "shoulders", label: "Hombros", hint: "Por lo más saliente de ambos deltoides, brazos relajados. Mejor con ayuda: solo es la medida menos fiable." },
  { key: "neck", label: "Cuello", hint: "Justo debajo de la nuez, cinta horizontal, cabeza recta." },
  { key: "arm", label: "Brazo relajado", hint: "Brazo colgando, máximo perímetro del bíceps sin contraer." },
  { key: "arm_flexed", label: "Brazo flexionado", hint: "Codo a 90°, bíceps contraído al máximo, punto más ancho." },
  { key: "forearm", label: "Antebrazo", hint: "Brazo extendido, palma arriba, máximo perímetro cerca del codo." },
  { key: "thigh", label: "Muslo", hint: "Punto medio entre el pliegue inguinal y la rótula, de pie y relajado." },
  { key: "calf", label: "Gemelo", hint: "Máximo perímetro, de pie con el peso repartido." },
  { key: "wrist", label: "Muñeca", hint: "Punto más estrecho por encima del hueso de la muñeca. No cambia: basta una vez (tamaño de esqueleto)." },
  { key: "ankle", label: "Tobillo", hint: "Punto más estrecho por encima de los maléolos. No cambia: basta una vez." },
] as const;
export type MeasureSite = (typeof MEASURE_SITES)[number]["key"];
export const SITE_LABEL: Record<string, string> = Object.fromEntries(MEASURE_SITES.map((s) => [s.key, s.label]));

/** Skinfold sites (mm) of Jackson-Pollock 7; `jp3` = the three of the 3-site equation for that sex. */
export const SKINFOLD_SITES = [
  { key: "chest", label: "Pectoral", hint: "Diagonal, a 1/3 de la distancia de la axila al pezón.", jp3: ["male"] },
  { key: "midaxillary", label: "Axilar medio", hint: "Vertical, en la línea media de la axila a la altura del esternón (xifoides).", jp3: [] },
  { key: "triceps", label: "Tríceps", hint: "Vertical, detrás del brazo, a mitad entre hombro y codo, brazo relajado.", jp3: ["female"] },
  { key: "subscapular", label: "Subescapular", hint: "Diagonal a 45°, 1–2 cm bajo la punta de la escápula.", jp3: [] },
  { key: "abdominal", label: "Abdominal", hint: "Vertical, 2 cm a la derecha del ombligo.", jp3: ["male"] },
  { key: "suprailiac", label: "Suprailíaco", hint: "Diagonal, justo encima de la cresta ilíaca (hueso de la cadera).", jp3: ["female"] },
  { key: "thigh", label: "Muslo", hint: "Vertical, delante del muslo, a mitad entre ingle y rótula, pierna relajada.", jp3: ["male", "female"] },
] as const;
export type SkinfoldSite = (typeof SKINFOLD_SITES)[number]["key"];
export const SKINFOLD_LABEL: Record<string, string> = Object.fromEntries(SKINFOLD_SITES.map((s) => [s.key, s.label]));

/**
 * Body fat from skinfolds (Jackson & Pollock 1978 men / Jackson, Pollock & Ward 1980 women;
 * density → % with Siri). All 7 sites → 7-site equation; else the 3 sites of that sex.
 * Typical error ±3–4 points; most useful for the trend, with the same caliper and person.
 */
export function skinfoldBodyFatPct(i: { sex: "male" | "female"; age: number; folds: Partial<Record<string, number>> }): { pct: number; method: "jp7" | "jp3"; sumMm: number } | null {
  const f = i.folds;
  const val = (k: string) => (f[k] != null && f[k]! > 0 ? f[k]! : null);
  const all7 = SKINFOLD_SITES.map((s) => val(s.key));
  let density: number;
  let method: "jp7" | "jp3";
  let sum: number;
  if (all7.every((v) => v != null)) {
    sum = all7.reduce<number>((a, v) => a + v!, 0);
    method = "jp7";
    density = i.sex === "male" ? 1.112 - 0.00043499 * sum + 0.00000055 * sum * sum - 0.00028826 * i.age : 1.097 - 0.00046971 * sum + 0.00000056 * sum * sum - 0.00012828 * i.age;
  } else {
    const three = SKINFOLD_SITES.filter((s) => (s.jp3 as readonly string[]).includes(i.sex)).map((s) => val(s.key));
    if (three.some((v) => v == null)) return null;
    sum = three.reduce<number>((a, v) => a + v!, 0);
    method = "jp3";
    density = i.sex === "male" ? 1.10938 - 0.0008267 * sum + 0.0000016 * sum * sum - 0.0002574 * i.age : 1.0994921 - 0.0009929 * sum + 0.0000023 * sum * sum - 0.0001392 * i.age;
  }
  const pct = 495 / density - 450;
  if (!Number.isFinite(pct) || pct < 2 || pct > 60) return null;
  return { pct: Math.round(pct * 10) / 10, method, sumMm: Math.round(sum * 10) / 10 };
}

/**
 * US Navy circumference method (metric). Men: neck and waist; women: neck, waist and hips.
 * Typical error ±3–4 points: good for the trend, not for the absolute value.
 */
export function navyBodyFatPct(i: { sex: "male" | "female"; heightCm: number; neckCm: number; waistCm: number; hipCm?: number | null }): number | null {
  const { heightCm: h, neckCm: n, waistCm: w } = i;
  if (!(h > 100 && n > 15 && w > 30)) return null;
  let pct: number;
  if (i.sex === "male") {
    if (w - n <= 0) return null;
    pct = 495 / (1.0324 - 0.19077 * Math.log10(w - n) + 0.15456 * Math.log10(h)) - 450;
  } else {
    if (!i.hipCm || w + i.hipCm - n <= 0) return null;
    pct = 495 / (1.29579 - 0.35004 * Math.log10(w + i.hipCm - n) + 0.221 * Math.log10(h)) - 450;
  }
  if (!Number.isFinite(pct) || pct < 3 || pct > 60) return null;
  return Math.round(pct * 10) / 10;
}

export interface BodyComposition {
  fatKg: number;
  leanKg: number;
  /** Fat-free mass index (kg/m²). */
  ffmi: number;
  /** FFMI normalised to 1.80 m. */
  ffmiNorm: number;
}

export function bodyComposition(weightKg: number, bodyFatPct: number, heightCm: number): BodyComposition {
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const fat = (weightKg * bodyFatPct) / 100;
  const lean = weightKg - fat;
  const m = heightCm / 100;
  const ffmi = lean / (m * m);
  return { fatKg: r1(fat), leanKg: r1(lean), ffmi: r1(ffmi), ffmiNorm: r1(ffmi + 6.1 * (1.8 - m)) };
}

/** Rough reading of a normalised FFMI (men; women run about 3 points lower). */
export function ffmiLabel(ffmiNorm: number, sex: "male" | "female"): string {
  const v = sex === "female" ? ffmiNorm + 3 : ffmiNorm;
  return v < 18 ? "por debajo de la media" : v < 20 ? "en la media" : v < 22 ? "por encima de la media" : v < 25 ? "muy musculado" : "cerca del límite natural";
}

export interface CompositionPoint extends BodyComposition {
  date: string;
  weightKg: number;
  bodyFatPct: number;
  /** measured = entered with the weigh-in (scale, DXA…); skinfolds = calipers (Jackson-Pollock); navy = tape. */
  source: "measured" | "skinfolds" | "navy";
}

/**
 * Composition over time. A measured % (weigh-in) wins over the tape estimate on the same day.
 * Tape estimates use the measurements of one day and the closest weigh-in within a week.
 */
export function compositionSeries(i: {
  sex: "male" | "female" | null;
  heightCm: number | null;
  weights: { date: string; kg: number; bodyFatPct?: number | null }[];
  measures: { date: string; site: string; cm: number }[];
  /** Skinfolds (mm) and birth date (age at each date) for the Jackson-Pollock estimate. */
  folds?: { date: string; site: string; mm: number }[];
  birthDate?: string | null;
}): CompositionPoint[] {
  if (!i.heightCm) return [];
  const h = i.heightCm;
  const out = new Map<string, CompositionPoint>();
  const nearestWeight = (date: string) => {
    let best: { kg: number; d: number } | null = null;
    for (const w of i.weights) {
      const d = Math.abs(daysBetween(w.date, date));
      if (d <= 7 && (!best || d < best.d)) best = { kg: w.kg, d };
    }
    return best?.kg ?? null;
  };
  if (i.sex) {
    const byDate = new Map<string, Record<string, number>>();
    for (const m of i.measures) byDate.set(m.date, { ...(byDate.get(m.date) ?? {}), [m.site]: m.cm });
    for (const [date, s] of byDate) {
      if (s.neck == null || s.waist == null) continue;
      const pct = navyBodyFatPct({ sex: i.sex, heightCm: h, neckCm: s.neck, waistCm: s.waist, hipCm: s.hips });
      const kg = nearestWeight(date);
      if (pct == null || kg == null) continue;
      out.set(date, { date, weightKg: kg, bodyFatPct: pct, source: "navy", ...bodyComposition(kg, pct, h) });
    }
  }
  // Calipers beat the tape on the same day.
  if (i.sex && i.birthDate && i.folds?.length) {
    const byDate = new Map<string, Record<string, number>>();
    for (const f of i.folds) byDate.set(f.date, { ...(byDate.get(f.date) ?? {}), [f.site]: f.mm });
    for (const [date, folds] of byDate) {
      const age = Math.floor(daysBetween(i.birthDate, date) / 365.25);
      const r = skinfoldBodyFatPct({ sex: i.sex, age, folds });
      const kg = nearestWeight(date);
      if (!r || kg == null) continue;
      out.set(date, { date, weightKg: kg, bodyFatPct: r.pct, source: "skinfolds", ...bodyComposition(kg, r.pct, h) });
    }
  }
  for (const w of i.weights) {
    if (w.bodyFatPct == null || w.bodyFatPct < 3 || w.bodyFatPct > 60) continue;
    out.set(w.date, { date: w.date, weightKg: w.kg, bodyFatPct: w.bodyFatPct, source: "measured", ...bodyComposition(w.kg, w.bodyFatPct, h) });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Progress photos every 4 weeks: due on day 28, 56… after the last one. */
export function photoReminderDue(lastPhotoDate: string | null, today: string) {
  if (!lastPhotoDate) return false;
  const d = daysBetween(lastPhotoDate, today);
  return d >= 28 && d % 28 === 0;
}
