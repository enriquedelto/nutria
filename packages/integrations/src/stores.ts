/**
 * Supermarket adapters (pluggable). The app never pays: it reaches a cart or an ordered list
 * with direct product links; checkout happens on the store's website.
 *
 * Mercadona: unofficial public catalogue API (tienda.mercadona.es/api). May break without notice;
 * everything is isolated behind StoreProvider and failures degrade to the manual list.
 */
export interface StoreProduct {
  id: string;
  name: string;
  brand?: string | null;
  packSize?: string | null;
  packGrams?: number | null;
  price: number;
  pricePerKg?: number | null;
  imageUrl?: string | null;
  url: string;
  category?: string | null;
  barcode?: string | null;
}

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface CartResult {
  mode: "cart" | "links";
  url?: string;
  lines: { productId: string; quantity: number; url: string }[];
  message: string;
}

export interface StoreProvider {
  code: string;
  name: string;
  /** Full catalogue crawl (weekly) → cached locally for search & prices. */
  crawl(opts?: { warehouse?: string; onProgress?: (n: number) => void }): AsyncGenerator<StoreProduct>;
  product(id: string, opts?: { warehouse?: string }): Promise<StoreProduct | null>;
  /** Push lines to the user's cart if supported, otherwise return ordered deep links. */
  toCart(lines: CartLine[], account?: { token?: string; customerId?: string }): Promise<CartResult>;
}

interface MercadonaPriceInstructions {
  unit_price?: string;
  bulk_price?: string;
  unit_size?: number;
  size_format?: string; // kg | l | ud
  reference_price?: string;
  reference_format?: string;
}
interface MercadonaProduct {
  id: string;
  display_name: string;
  packaging?: string;
  thumbnail?: string;
  share_url?: string;
  price_instructions?: MercadonaPriceInstructions;
  ean?: string;
  brand?: string;
}
interface MercadonaCategory {
  id: number;
  name: string;
  categories?: MercadonaCategory[];
  products?: MercadonaProduct[];
}

export function mapMercadonaProduct(p: MercadonaProduct, category?: string): StoreProduct {
  const pi = p.price_instructions ?? {};
  const price = Number(pi.unit_price ?? pi.bulk_price ?? 0);
  const size = pi.unit_size ?? null;
  const fmt = (pi.size_format ?? "").toLowerCase();
  const packGrams = size != null && (fmt === "kg" || fmt === "l") ? size * 1000 : null;
  const ref = Number(pi.reference_price ?? pi.bulk_price ?? NaN);
  const refFmt = (pi.reference_format ?? "").toLowerCase();
  return {
    id: String(p.id),
    name: p.display_name,
    brand: p.brand ?? null,
    packSize: [p.packaging, size != null ? `${size} ${fmt}` : null].filter(Boolean).join(" ") || null,
    packGrams,
    price,
    pricePerKg: Number.isFinite(ref) && (refFmt === "kg" || refFmt === "l") ? ref : packGrams ? (price / packGrams) * 1000 : null,
    imageUrl: p.thumbnail ?? null,
    url: p.share_url ?? `https://tienda.mercadona.es/product/${p.id}`,
    category: category ?? null,
    barcode: p.ean ?? null,
  };
}

export class MercadonaProvider implements StoreProvider {
  code = "mercadona";
  name = "Mercadona";
  private base = "https://tienda.mercadona.es/api";
  constructor(private f: typeof fetch = fetch) {}

  private async get<T>(path: string, wh?: string): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    const r = await this.f(`${this.base}${path}${sep}lang=es${wh ? `&wh=${wh}` : ""}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Nutria/0.1)", Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Mercadona respondió ${r.status}`);
    return (await r.json()) as T;
  }

  async *crawl(opts: { warehouse?: string; onProgress?: (n: number) => void } = {}): AsyncGenerator<StoreProduct> {
    const top = await this.get<{ results: MercadonaCategory[] }>("/categories/", opts.warehouse);
    let n = 0;
    for (const group of top.results) {
      for (const sub of group.categories ?? []) {
        const detail = await this.get<MercadonaCategory>(`/categories/${sub.id}/`, opts.warehouse);
        for (const leaf of detail.categories ?? []) {
          for (const p of leaf.products ?? []) {
            n++;
            yield mapMercadonaProduct(p, `${group.name} › ${leaf.name}`);
          }
        }
        opts.onProgress?.(n);
        await new Promise((r) => setTimeout(r, 400)); // be gentle
      }
    }
  }

  async product(id: string, opts: { warehouse?: string } = {}): Promise<StoreProduct | null> {
    try {
      return mapMercadonaProduct(await this.get<MercadonaProduct>(`/products/${id}/`, opts.warehouse));
    } catch {
      return null;
    }
  }

  async toCart(lines: CartLine[]): Promise<CartResult> {
    // The authenticated cart API is undocumented; we return ordered deep links instead.
    return {
      mode: "links",
      lines: lines.map((l) => ({ ...l, url: `https://tienda.mercadona.es/product/${l.productId}` })),
      message: "Abre cada producto en la web de Mercadona para añadirlo al carrito. El pago se hace siempre en su web.",
    };
  }
}

export const STORE_PROVIDERS: Record<string, () => StoreProvider> = {
  mercadona: () => new MercadonaProvider(),
};

/* --------------------------------- Open Prices --------------------------------- */

export interface OpenPrice {
  price: number;
  currency: string;
  date: string;
  locationName?: string | null;
}

export async function openPrices(barcode: string, f: typeof fetch = fetch): Promise<OpenPrice[]> {
  const r = await f(`https://prices.openfoodfacts.org/api/v1/prices?product_code=${encodeURIComponent(barcode)}&order_by=-date&size=10`, {
    headers: { "User-Agent": process.env.OFF_USER_AGENT ?? "Nutria/0.1", Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return [];
  const j = (await r.json()) as { items?: { price: number; currency: string; date: string; location?: { osm_name?: string } }[] };
  return (j.items ?? []).map((i) => ({ price: i.price, currency: i.currency, date: i.date, locationName: i.location?.osm_name ?? null }));
}
