/**
 * Open Prices write API (prices.openfoodfacts.org) and OpenStreetMap place search (Nominatim) for
 * receipt stores. Open Prices locations are OSM elements, so a store needs its OSM id to share.
 */

const UA = () => process.env.OFF_USER_AGENT ?? "Nutria/0.1 (self-hosted nutrition app)";

/** Write base: OPEN_PRICES_WRITE_URL (e.g. the .net staging server) or the read base. */
export const openPricesWriteBase = () => (process.env.OPEN_PRICES_WRITE_URL ?? process.env.OPEN_PRICES_URL ?? "https://prices.openfoodfacts.org").replace(/\/$/, "");

export class OpenPricesError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OpenPricesError";
  }
}

async function opFetch<T>(path: string, init: RequestInit & { token?: string }, f: typeof fetch): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", UA());
  headers.set("Accept", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  const r = await f(`${openPricesWriteBase()}${path}`, { ...init, headers, signal: AbortSignal.timeout(30_000) });
  const text = await r.text();
  if (!r.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { detail?: unknown };
      if (j.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail).slice(0, 300);
    } catch {
      /* not JSON */
    }
    throw new OpenPricesError(`Open Prices ${r.status}: ${detail}`, r.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Exchange the Open Food Facts user id + password for a bearer token (the password is not kept). */
export async function openPricesLogin(username: string, password: string, f: typeof fetch = fetch): Promise<string> {
  const body = new URLSearchParams({ username, password });
  const j = await opFetch<{ access_token?: string; token?: string }>("/api/v1/auth", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } }, f);
  const token = j.access_token ?? j.token;
  if (!token) throw new OpenPricesError("Open Prices no devolvió token", 502);
  return token;
}

export interface ProofMeta {
  osmId: number;
  osmType: string;
  date: string;
  currency: string;
  priceCount: number;
  total: number | null;
}

/** Upload the (already cropped) receipt image as a RECEIPT proof. */
export async function openPricesUploadReceipt(token: string, image: { data: Buffer; mime: string }, meta: ProofMeta, f: typeof fetch = fetch): Promise<number> {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(image.data)], { type: image.mime }), image.mime === "image/png" ? "ticket.png" : "ticket.jpg");
  form.set("type", "RECEIPT");
  form.set("location_osm_id", String(meta.osmId));
  form.set("location_osm_type", meta.osmType);
  form.set("date", meta.date);
  form.set("currency", meta.currency);
  form.set("receipt_price_count", String(meta.priceCount));
  if (meta.total != null) form.set("receipt_price_total", meta.total.toFixed(2));
  form.set("owner_consumption", "true");
  const j = await opFetch<{ id: number }>("/api/v1/proofs/upload", { method: "POST", body: form, token }, f);
  return j.id;
}

export interface OpenPriceInput {
  productCode: string;
  price: number;
  discounted?: boolean;
  priceWithoutDiscount?: number | null;
  quantity?: number;
}

export async function openPricesAddPrice(token: string, proofId: number, meta: Pick<ProofMeta, "osmId" | "osmType" | "date" | "currency">, p: OpenPriceInput, f: typeof fetch = fetch): Promise<number> {
  const body = {
    product_code: p.productCode,
    price: Math.round(p.price * 100) / 100,
    price_is_discounted: !!p.discounted,
    ...(p.discounted && p.priceWithoutDiscount ? { price_without_discount: Math.round(p.priceWithoutDiscount * 100) / 100 } : {}),
    currency: meta.currency,
    date: meta.date,
    location_osm_id: meta.osmId,
    location_osm_type: meta.osmType,
    proof_id: proofId,
    ...(p.quantity && p.quantity > 1 ? { receipt_quantity: p.quantity } : {}),
  };
  const j = await opFetch<{ id: number }>("/api/v1/prices", { method: "POST", body: JSON.stringify(body), token, headers: { "Content-Type": "application/json" } }, f);
  return j.id;
}

/* ------------------------------- Nominatim ------------------------------- */

export interface Place {
  osmId: number;
  osmType: "NODE" | "WAY" | "RELATION";
  name: string;
  displayName: string;
  lat: number;
  lon: number;
}

/**
 * Search shops in OpenStreetMap (Nominatim usage policy: identify the app, ≤ 1 request/s; we only
 * search once per new store, when the user reviews a receipt).
 */
export async function searchPlaces(q: string, f: typeof fetch = fetch): Promise<Place[]> {
  const base = (process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org").replace(/\/$/, "");
  const url = `${base}/search?format=jsonv2&limit=5&countrycodes=es&accept-language=es&q=${encodeURIComponent(q)}`;
  const r = await f(url, { headers: { "User-Agent": UA(), Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return [];
  type Row = { osm_id: number; osm_type: string; name?: string; display_name: string; lat: string; lon: string };
  const rows = (await r.json()) as Row[];
  return rows
    .filter((x) => ["node", "way", "relation"].includes(x.osm_type))
    .map((x) => ({ osmId: Number(x.osm_id), osmType: x.osm_type.toUpperCase() as Place["osmType"], name: x.name || x.display_name.split(",")[0]!, displayName: x.display_name, lat: Number(x.lat), lon: Number(x.lon) }));
}
