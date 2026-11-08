import { NUTRIENT_BY_CODE, displayAmount, type NutrientUnit } from "@nutria/nutrition";

const nf0 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });

export const n0 = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "—" : nf0.format(v));
export const n1 = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "—" : nf1.format(v));

export type EnergyUnit = "kcal" | "kj";
export const energy = (kcal: number | null | undefined, unit: EnergyUnit = "kcal") =>
  kcal == null ? "—" : unit === "kj" ? `${nf0.format(kcal * 4.184)} kJ` : `${nf0.format(kcal)} kcal`;

export const grams = (g: number | null | undefined) => (g == null ? "—" : `${g < 10 ? nf1.format(g) : nf0.format(g)} g`);

export function nutrient(code: string, amount: number) {
  const def = NUTRIENT_BY_CODE[code];
  return def ? displayAmount(amount, def.unit as NutrientUnit) : nf1.format(amount);
}

export const nutrientName = (code: string) => NUTRIENT_BY_CODE[code]?.nameEs ?? code;

const dfLong = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dfShort = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
const dfWeekday = new Intl.DateTimeFormat("es-ES", { weekday: "short", timeZone: "UTC" });

/** Dates are plain YYYY-MM-DD strings; format them at UTC noon to avoid TZ drift. */
const at = (d: string) => new Date(`${d}T12:00:00Z`);
export const dateLong = (d: string) => dfLong.format(at(d));
export const dateShort = (d: string) => dfShort.format(at(d));
export const weekday = (d: string) => dfWeekday.format(at(d));

export function relativeDay(d: string, today: string) {
  const diff = Math.round((at(d).getTime() - at(today).getTime()) / 86_400_000);
  if (diff === 0) return "Hoy";
  if (diff === -1) return "Ayer";
  if (diff === 1) return "Mañana";
  return dateLong(d).replace(/^\w/, (c) => c.toUpperCase());
}

export const time = (d: Date | string, tz = "Europe/Madrid") =>
  new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(typeof d === "string" ? new Date(d) : d);

export const kg = (v: number | null | undefined) => (v == null ? "—" : `${nf1.format(v)} kg`);

export const pct = (v: number | null | undefined) => (v == null ? "—" : `${nf0.format(v)} %`);

export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
