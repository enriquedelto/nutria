import { assertPublicUrl } from "./net";

/**
 * Recipe import from web pages via schema.org/Recipe JSON-LD (microdata fallback is left to AI).
 */
export interface ImportedRecipe {
  title: string;
  description: string | null;
  servings: number | null;
  prepMin: number | null;
  cookMin: number | null;
  totalMin: number | null;
  imageUrl: string | null;
  ingredients: string[];
  steps: { text: string; section?: string }[];
  tags: string[];
  sourceUrl: string;
  nutrition: Record<string, string> | null;
}

/** ISO 8601 duration (PT1H30M) → minutes. */
export function isoDurationMinutes(d: unknown): number | null {
  if (typeof d !== "string") return null;
  const m = d.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const mins = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Math.round(Number(m[4] ?? 0) / 60);
  return mins || null;
}

const decodeEntities = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

function asArray<T>(v: T | T[] | undefined | null): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

function isRecipe(node: Record<string, unknown>): boolean {
  const t = node["@type"];
  return asArray(t as string | string[]).some((x) => String(x).toLowerCase() === "recipe");
}

function findRecipe(data: unknown): Record<string, unknown> | null {
  for (const node of asArray(data as Record<string, unknown> | Record<string, unknown>[])) {
    if (!node || typeof node !== "object") continue;
    if (isRecipe(node)) return node;
    if (node["@graph"]) {
      const r = findRecipe(node["@graph"]);
      if (r) return r;
    }
    if (node.mainEntity) {
      const r = findRecipe(node.mainEntity);
      if (r) return r;
    }
  }
  return null;
}

function parseSteps(instr: unknown, section?: string): { text: string; section?: string }[] {
  const out: { text: string; section?: string }[] = [];
  for (const it of asArray(instr as unknown)) {
    if (typeof it === "string") {
      for (const line of decodeEntities(it).split(/(?:\r?\n)+|(?<=\.)\s+(?=\d+\.\s)/)) if (line.trim()) out.push({ text: line.trim().replace(/^\d+[.)]\s*/, ""), section });
    } else if (it && typeof it === "object") {
      const o = it as Record<string, unknown>;
      const type = String(o["@type"] ?? "");
      if (type === "HowToSection") out.push(...parseSteps(o.itemListElement, String(o.name ?? "")));
      else if (o.text || o.name) out.push({ text: decodeEntities(String(o.text ?? o.name)), section });
    }
  }
  return out.filter((s) => s.text.length > 1);
}

function parseYield(y: unknown): number | null {
  for (const v of asArray(y as unknown)) {
    const m = String(v).match(/\d+/);
    if (m) return Number(m[0]);
  }
  return null;
}

function parseImage(img: unknown): string | null {
  const first = asArray(img as unknown)[0];
  if (!first) return null;
  if (typeof first === "string") return first;
  if (typeof first === "object") return String((first as Record<string, unknown>).url ?? "") || null;
  return null;
}

export function extractJsonLdRecipe(html: string, sourceUrl: string): ImportedRecipe | null {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!);
  for (const s of scripts) {
    let data: unknown;
    try {
      data = JSON.parse(s.trim());
    } catch {
      try {
        // eslint-disable-next-line no-control-regex -- strip raw control chars that break JSON.parse
        data = JSON.parse(s.trim().replace(/[\u0000-\u001f]+/g, " "));
      } catch {
        continue;
      }
    }
    const r = findRecipe(data);
    if (!r) continue;
    const kw = typeof r.keywords === "string" ? r.keywords.split(",") : asArray(r.keywords as string[]);
    const tags = [...kw, ...asArray(r.recipeCategory as string[]), ...asArray(r.recipeCuisine as string[])].map((t) => String(t).trim().toLowerCase()).filter(Boolean);
    const nutrition = r.nutrition && typeof r.nutrition === "object" ? Object.fromEntries(Object.entries(r.nutrition as Record<string, unknown>).filter(([k]) => !k.startsWith("@")).map(([k, v]) => [k, String(v)])) : null;
    return {
      title: decodeEntities(String(r.name ?? "Receta")),
      description: r.description ? decodeEntities(String(r.description)) : null,
      servings: parseYield(r.recipeYield),
      prepMin: isoDurationMinutes(r.prepTime),
      cookMin: isoDurationMinutes(r.cookTime),
      totalMin: isoDurationMinutes(r.totalTime),
      imageUrl: parseImage(r.image),
      ingredients: asArray(r.recipeIngredient as string[]).map((i) => decodeEntities(String(i))).filter(Boolean),
      steps: parseSteps(r.recipeInstructions),
      tags: [...new Set(tags)].slice(0, 12),
      sourceUrl,
      nutrition,
    };
  }
  return null;
}

/** Visible text of a page (for AI fallback when there is no JSON-LD). */
export function pageText(html: string, max = 20000): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, " "),
  ).slice(0, max);
}

/** Fetch with browser-like UA; optional FlareSolverr fallback for sites blocking servers. */
export async function fetchPage(url: string, opts: { flaresolverrUrl?: string; fetch?: typeof fetch } = {}): Promise<string> {
  const f = opts.fetch ?? fetch;
  let current = (await assertPublicUrl(url)).toString();
  let r: Response | null = null;
  for (let hop = 0; hop < 5; hop++) {
    r = await f(current, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Nutria/0.1; +recipe-import)", Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    });
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (!loc) break;
    current = (await assertPublicUrl(new URL(loc, current).toString())).toString();
  }
  if (r?.ok) {
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > 8_000_000) throw new Error("Página demasiado grande");
    return await r.text();
  }
  if (opts.flaresolverrUrl && r && (r.status === 403 || r.status === 503)) {
    const fr = await f(`${opts.flaresolverrUrl.replace(/\/$/, "")}/v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "request.get", url: current, maxTimeout: 60000 }),
    });
    const j = (await fr.json()) as { solution?: { response?: string } };
    if (j.solution?.response) return j.solution.response;
  }
  throw new Error(`No se pudo descargar la página (${r?.status ?? "sin respuesta"})`);
}
