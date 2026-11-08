/**
 * Open Food Facts client (API v2 product + search-a-licious), with a client-side rate limiter.
 * OFF asks for a descriptive User-Agent and ~100 product reads/min, ~10 searches/min.
 */
import { normalizeOff, type FoodInput, type OffProduct } from "@nutria/nutrition";

export const OFF_FIELDS = [
  "code", "product_name", "product_name_es", "generic_name_es", "brands", "quantity", "image_front_small_url", "image_front_url",
  "nutriments", "nutriscore_grade", "nova_group", "ecoscore_grade", "additives_tags", "allergens_tags", "traces_tags",
  "categories_tags", "labels_tags", "ingredients_text_es", "ingredients_text", "countries_tags", "serving_size",
  "serving_quantity", "product_quantity", "completeness",
].join(",");

class RateLimiter {
  private stamps: number[] = [];
  constructor(private perMinute: number) {}
  async take() {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 60_000);
      if (this.stamps.length < this.perMinute) {
        this.stamps.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, 60_000 - (now - this.stamps[0]!) + 10));
    }
  }
}

export interface OffClientOptions {
  userAgent?: string;
  baseUrl?: string;
  searchUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class OffClient {
  private readLimiter = new RateLimiter(90);
  private searchLimiter = new RateLimiter(9);
  private ua: string;
  private base: string;
  private searchBase: string;
  private f: typeof fetch;
  private timeout: number;

  constructor(o: OffClientOptions = {}) {
    this.ua = o.userAgent ?? process.env.OFF_USER_AGENT ?? "Nutria/0.1 (self-hosted)";
    this.base = o.baseUrl ?? "https://world.openfoodfacts.org";
    this.searchBase = o.searchUrl ?? "https://search.openfoodfacts.org";
    this.f = o.fetch ?? fetch;
    this.timeout = o.timeoutMs ?? 8000;
  }

  private async get(url: string): Promise<Response> {
    return this.f(url, { headers: { "User-Agent": this.ua, Accept: "application/json" }, signal: AbortSignal.timeout(this.timeout) });
  }

  async product(barcode: string): Promise<FoodInput | null> {
    if (!/^\d{6,14}$/.test(barcode)) return null;
    await this.readLimiter.take();
    const r = await this.get(`${this.base}/api/v2/product/${barcode}.json?fields=${OFF_FIELDS}&lc=es`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`OFF ${r.status}`);
    const j = (await r.json()) as { status?: number; product?: OffProduct };
    if (!j.product || j.status === 0) return null;
    return normalizeOff({ ...j.product, code: j.product.code ?? barcode });
  }

  async search(q: string, opts: { page?: number; pageSize?: number; countries?: string } = {}): Promise<FoodInput[]> {
    await this.searchLimiter.take();
    const params = new URLSearchParams({
      q: opts.countries ? `${q} countries_tags:"${opts.countries}"` : q,
      langs: "es,en",
      page_size: String(opts.pageSize ?? 20),
      page: String(opts.page ?? 1),
      fields: OFF_FIELDS,
    });
    const r = await this.get(`${this.searchBase}/search?${params}`);
    if (!r.ok) throw new Error(`OFF search ${r.status}`);
    const j = (await r.json()) as { hits?: Record<string, unknown>[] };
    return (j.hits ?? [])
      .map((h) => normalizeOff(flattenSearchHit(h)))
      .filter((x): x is FoodInput => x != null);
  }

  /** Upload a product / nutrition facts (requires the user's OFF credentials). */
  async contribute(
    creds: { user: string; password: string },
    p: { code: string; productName: string; brands?: string; nutriments?: Record<string, number>; servingSize?: string },
  ): Promise<boolean> {
    const body = new URLSearchParams({ code: p.code, user_id: creds.user, password: creds.password, product_name_es: p.productName, lang: "es" });
    if (p.brands) body.set("brands", p.brands);
    if (p.servingSize) body.set("serving_size", p.servingSize);
    if (p.nutriments) {
      body.set("nutrition_data_per", "100g");
      for (const [k, v] of Object.entries(p.nutriments)) body.set(`nutriment_${k}`, String(v));
    }
    const r = await this.f(`${this.base}/cgi/product_jqm2.pl`, { method: "POST", headers: { "User-Agent": this.ua }, body });
    const j = (await r.json().catch(() => ({}))) as { status?: number };
    return r.ok && j.status === 1;
  }
}

/** search-a-licious returns some fields as arrays/objects (e.g. localized names). */
export function flattenSearchHit(h: Record<string, unknown>): OffProduct {
  const out: Record<string, unknown> = { ...h };
  for (const k of ["product_name", "product_name_es", "generic_name_es", "brands", "ingredients_text", "ingredients_text_es"]) {
    const v = h[k];
    if (Array.isArray(v)) out[k] = v.join(", ");
    else if (v && typeof v === "object") out[k] = (v as Record<string, string>).es ?? (v as Record<string, string>).main ?? Object.values(v)[0];
  }
  return out as OffProduct;
}

/* ----------------------------- OFF TSV dump (mirror) ---------------------------- */

/**
 * Convert a row of the OFF CSV/TSV export (en.openfoodfacts.org.products.csv) into an OffProduct.
 * Nutriment columns end in `_100g`; tag columns are comma-separated.
 */
export function offTsvRowToProduct(row: Record<string, string>): OffProduct {
  const nutriments: Record<string, number> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith("_100g") && v !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) nutriments[k] = n;
    }
  }
  const tags = (k: string) => (row[k] ? row[k]!.split(",").filter(Boolean) : []);
  return {
    code: row.code,
    product_name: row.product_name,
    product_name_es: row.product_name_es,
    generic_name_es: row.generic_name,
    brands: row.brands,
    quantity: row.quantity,
    image_front_small_url: row.image_small_url,
    image_front_url: row.image_url,
    nutriments,
    nutriscore_grade: row.nutriscore_grade,
    nova_group: row.nova_group,
    ecoscore_grade: row.environmental_score_grade || row.ecoscore_grade,
    additives_tags: tags("additives_tags"),
    allergens_tags: tags("allergens_tags").length ? tags("allergens_tags") : tags("allergens"),
    traces_tags: tags("traces_tags"),
    categories_tags: tags("categories_tags"),
    labels_tags: tags("labels_tags"),
    ingredients_text: row.ingredients_text,
    countries_tags: tags("countries_tags"),
    serving_size: row.serving_size,
    serving_quantity: row.serving_quantity,
    product_quantity: row.product_quantity,
    completeness: row.completeness,
  };
}

/** Header-aware TSV line parser (OFF export uses tabs and no quoting). */
export function tsvParser(header: string) {
  const cols = header.split("\t");
  return (line: string): Record<string, string> => {
    const vals = line.split("\t");
    const o: Record<string, string> = {};
    for (let i = 0; i < cols.length; i++) o[cols[i]!] = vals[i] ?? "";
    return o;
  };
}

/** Mirror filter: Spain (or nearby) products with minimal nutrition data. */
export function keepForMirror(p: OffProduct, countries = ["en:spain"]): boolean {
  if (!p.code || !(p.product_name || p.product_name_es)) return false;
  if (!(p.countries_tags ?? []).some((c) => countries.includes(c))) return false;
  const n = p.nutriments ?? {};
  return n["energy-kcal_100g"] != null || n["energy_100g"] != null || n["energy-kj_100g"] != null;
}
