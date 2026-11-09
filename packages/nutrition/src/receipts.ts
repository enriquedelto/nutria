/** Pure helpers for shopping receipts: line normalisation, pack sizes, unit prices and matching. */

const strip = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");

/** Key for learned aliases: lowercase, no accents, no punctuation, single spaces. */
export function normReceiptText(text: string): string {
  return strip(text.toLowerCase())
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Chain key from the ticket header ("MERCADONA, S.A." → "mercadona"). */
export function chainKey(s: string | null | undefined): string {
  if (!s) return "";
  const n = normReceiptText(s).replace(/\b(s ?a|s ?l|s ?a ?u|supermercados?|hipermercados?|sociedad|cooperativa)\b/g, "").trim();
  return n.split(" ")[0] ?? "";
}

/**
 * Grams (or ml) in a pack label: "500 g", "1 l", "1,5 kg", "6 x 200 ml", "pack 4 x 125 g", "75cl".
 * Null when it cannot be read.
 */
export function packGramsOf(label: string | null | undefined): number | null {
  if (!label) return null;
  const s = label.toLowerCase().replace(",", ".");
  const m = /(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|gr|l|cl|ml)\b/.exec(s);
  if (!m) return null;
  const n = m[1] ? Number(m[1]) : 1;
  const v = Number(m[2]);
  const f = { kg: 1000, g: 1, gr: 1, l: 1000, cl: 10, ml: 1 }[m[3] as "kg"] ?? 1;
  const g = n * v * f;
  return g > 0 && g < 100_000 ? g : null;
}

export interface ReceiptLinePrice {
  /** Price of one unit (or of the weighed amount for kg/l lines). */
  price: number;
  pricePerKg: number | null;
  packGrams: number | null;
}

/**
 * Comparable price for a receipt line. Weighed lines: €/kg is the unit price. Unit lines: price per
 * unit (line total / quantity) and €/kg from the pack size when known.
 */
export function receiptLinePrice(line: { quantity: number; unit: "ud" | "kg" | "l"; unitPrice?: number | null; lineTotal: number }, packLabel?: string | null): ReceiptLinePrice | null {
  if (!(line.lineTotal > 0) || !(line.quantity > 0)) return null;
  if (line.unit === "kg" || line.unit === "l") {
    const perKg = line.unitPrice && line.unitPrice > 0 ? line.unitPrice : line.lineTotal / line.quantity;
    return { price: round2(line.lineTotal), pricePerKg: round2(perKg), packGrams: Math.round(line.quantity * 1000) };
  }
  const unit = line.lineTotal / line.quantity;
  const g = packGramsOf(packLabel);
  return { price: round2(unit), pricePerKg: g ? round2((unit / g) * 1000) : null, packGrams: g };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const STOP = new Set(["de", "del", "la", "el", "los", "las", "y", "con", "en", "al", "a", "sin", "ud", "uds", "x", "pack", "bandeja", "eco"]);
const tokens = (s: string) => normReceiptText(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+([.,]\d+)?(g|kg|ml|l|cl)?$/.test(t));

/** 0..1 overlap of meaningful words (prefix matches count: "semi" ~ "semidesnatada"). */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const hit = (x: string, ys: string[]) => ys.some((y) => y === x || (x.length >= 3 && y.startsWith(x)) || (y.length >= 3 && x.startsWith(y)));
  const ab = ta.filter((x) => hit(x, tb)).length / ta.length;
  const ba = tb.filter((y) => hit(y, ta)).length / tb.length;
  return Math.round(((ab + ba) / 2) * 100) / 100;
}
