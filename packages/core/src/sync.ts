/** External data sync: openGym, Open Food Facts (API + mirror), CIQUAL, store catalogues. */
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { and, eq, exerciseLogs, foods, foodServings, inArray, integrationAccounts, isNull, prices, sql, stores, weightLogs, type Database } from "@nutria/db";
import {
  decrypt,
  encrypt, newToken,
  keepForMirror,
  mapOpenGymState,
  OffClient,
  OpenGymClient,
  offTsvRowToProduct,
  STORE_PROVIDERS,
  tsvParser,
  type StoreProduct,
} from "@nutria/integrations";
import { macroColumns, normalizeCiqual, normalizeOff, todayIn, type CiqualRow, type FoodInput } from "@nutria/nutrition";
import { recomputeDay } from "./summaries";
import { latestWeight } from "./targets";

/* ---------------------------------- foods --------------------------------- */

/** Postgres real holds ~1e-37…3e38: crowd-sourced data has values like 7e-47 or 1e40. */
const realValue = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || Math.abs(v) > 1e7 ? null : Math.abs(v) < 1e-9 ? 0 : v);

function cleanNutrients(n: FoodInput["nutrients"]) {
  const out: FoodInput["nutrients"] = {};
  for (const [k, v] of Object.entries(n)) {
    const c = realValue(v);
    if (c != null) out[k] = c;
  }
  return out;
}

function foodRow(input: FoodInput) {
  const f = { ...input, nutrients: cleanNutrients(input.nutrients) };
  const m = macroColumns(f.nutrients);
  return {
    source: f.source,
    sourceId: f.sourceId,
    barcode: f.barcode,
    kind: f.kind,
    name: f.name,
    nameEs: f.nameEs,
    brand: f.brand,
    quantityLabel: f.quantityLabel,
    imageUrl: f.imageUrl,
    kcal: f.nutrients.energy_kcal ?? (Object.keys(f.nutrients).length ? m.kcal : null),
    protein: f.nutrients.protein ?? null,
    carbs: f.nutrients.carbs ?? null,
    sugars: f.nutrients.sugars ?? null,
    fat: f.nutrients.fat ?? null,
    satFat: f.nutrients.sat_fat ?? null,
    fiber: f.nutrients.fiber ?? null,
    salt: f.nutrients.salt ?? null,
    nutrients: f.nutrients,
    density: realValue(f.density) ?? 1,
    nutriscore: f.nutriscore,
    nova: f.nova,
    ecoscore: f.ecoscore,
    additives: f.additives,
    allergens: f.allergens,
    traces: f.traces,
    categories: f.categories,
    labels: f.labels,
    ingredientsText: f.ingredientsText,
    countries: f.countries,
    completeness: realValue(f.completeness),
    fetchedAt: new Date(),
  };
}

/**
 * Upsert catalogue foods by (source, source_id). Keeps the Spanish name if the new data has none
 * (e.g. AI translations of CIQUAL) and replaces default servings.
 */
export async function upsertFoods(db: Database, items: FoodInput[]) {
  const valid = items.filter((f) => f.sourceId);
  if (!valid.length) return [];
  const rows = await db
    .insert(foods)
    .values(valid.map(foodRow))
    .onConflictDoUpdate({
      target: [foods.source, foods.sourceId],
      targetWhere: sql`${foods.sourceId} is not null`,
      set: {
        name: sql`excluded.name`,
        nameEs: sql`coalesce(excluded.name_es, ${foods.nameEs})`,
        brand: sql`excluded.brand`,
        barcode: sql`excluded.barcode`,
        quantityLabel: sql`excluded.quantity_label`,
        imageUrl: sql`coalesce(excluded.image_url, ${foods.imageUrl})`,
        kcal: sql`excluded.kcal`,
        protein: sql`excluded.protein`,
        carbs: sql`excluded.carbs`,
        sugars: sql`excluded.sugars`,
        fat: sql`excluded.fat`,
        satFat: sql`excluded.sat_fat`,
        fiber: sql`excluded.fiber`,
        salt: sql`excluded.salt`,
        nutrients: sql`excluded.nutrients`,
        nutriscore: sql`excluded.nutriscore`,
        nova: sql`excluded.nova`,
        ecoscore: sql`excluded.ecoscore`,
        additives: sql`excluded.additives`,
        allergens: sql`excluded.allergens`,
        traces: sql`excluded.traces`,
        categories: sql`excluded.categories`,
        labels: sql`excluded.labels`,
        ingredientsText: sql`excluded.ingredients_text`,
        countries: sql`excluded.countries`,
        completeness: sql`excluded.completeness`,
        fetchedAt: sql`excluded.fetched_at`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: foods.id, sourceId: foods.sourceId });
  const bySource = new Map(rows.map((r) => [r.sourceId, r.id]));
  const servings = valid.flatMap((f) => (f.servings ?? []).map((s) => ({ foodId: bySource.get(f.sourceId)!, label: s.label, grams: s.grams, isDefault: s.isDefault ?? false })).filter((s) => s.foodId && s.grams > 0 && s.grams < 1e6));
  if (servings.length) {
    await db.delete(foodServings).where(inArray(foodServings.foodId, [...new Set(servings.map((s) => s.foodId))]));
    await db.insert(foodServings).values(servings);
  }
  return rows;
}

/** Barcode lookup: local first, then OFF API (and cache it). */
export async function foodByBarcode(db: Database, barcode: string, off = new OffClient()) {
  const [local] = await db.select().from(foods).where(and(eq(foods.barcode, barcode), isNull(foods.groupId))).limit(1);
  const stale = local?.fetchedAt && Date.now() - local.fetchedAt.getTime() > 90 * 86_400_000;
  if (local && !stale) return local;
  try {
    const fresh = await off.product(barcode);
    if (!fresh) return local ?? null;
    const [row] = await upsertFoods(db, [fresh]);
    const [full] = await db.select().from(foods).where(eq(foods.id, row!.id)).limit(1);
    return full ?? null;
  } catch {
    return local ?? null;
  }
}

/**
 * Stream the OFF CSV export (tab-separated, optionally gzipped) and upsert products sold in the
 * given countries. Processes in batches to keep memory flat (~3 M rows worldwide).
 */
export async function importOffDump(db: Database, input: ReadableStream<Uint8Array> | NodeJS.ReadableStream, opts: { gzip?: boolean; countries?: string[]; batch?: number; onProgress?: (seen: number, kept: number) => void } = {}) {
  let stream: NodeJS.ReadableStream = "getReader" in input ? Readable.fromWeb(input as import("node:stream/web").ReadableStream<Uint8Array>) : input;
  if (opts.gzip) stream = stream.pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let parse: ((l: string) => Record<string, string>) | null = null;
  let buf: FoodInput[] = [];
  let seen = 0;
  let kept = 0;
  let failed = 0;
  const flush = async () => {
    if (!buf.length) return;
    const dedup = [...new Map(buf.map((b) => [b.sourceId, b])).values()];
    buf = [];
    try {
      await upsertFoods(db, dedup);
      kept += dedup.length;
    } catch {
      // One bad product must not sink a 3 M-row import: retry the batch row by row and skip the bad ones.
      for (const f of dedup) {
        try {
          await upsertFoods(db, [f]);
          kept++;
        } catch {
          failed++;
        }
      }
    }
    opts.onProgress?.(seen, kept);
  };
  for await (const line of rl) {
    if (!parse) {
      parse = tsvParser(line);
      continue;
    }
    seen++;
    const p = offTsvRowToProduct(parse(line));
    if (!keepForMirror(p, opts.countries)) continue;
    const f = normalizeOff(p);
    if (f) buf.push(f);
    if (buf.length >= (opts.batch ?? 500)) await flush();
  }
  await flush();
  return { seen, kept, failed };
}

export async function importCiqualRows(db: Database, rows: CiqualRow[], batch = 300) {
  let n = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch).map(normalizeCiqual);
    await upsertFoods(db, chunk);
    n += chunk.length;
  }
  return n;
}

/* --------------------------------- openGym -------------------------------- */

export interface OpenGymSyncResult {
  exercises: number;
  weights: number;
  rev: number;
}

/** Pull openGym state and upsert workouts/weigh-ins idempotently (by externalId). */
export async function syncOpenGym(db: Database, accountId: string, f?: typeof fetch): Promise<OpenGymSyncResult> {
  const [acc] = await db.select().from(integrationAccounts).where(eq(integrationAccounts.id, accountId)).limit(1);
  if (!acc || acc.provider !== "opengym" || !acc.personId || !acc.baseUrl || !acc.credentialsEnc) throw new Error("Cuenta de openGym no válida");
  const personId = acc.personId;
  const client = new OpenGymClient(acc.baseUrl, decrypt(acc.credentialsEnc), f);
  try {
    const lastRev = Number(acc.meta.rev ?? -1);
    const { state, rev } = await client.data();
    if (!state || rev === lastRev) {
      await db.update(integrationAccounts).set({ lastSyncAt: new Date(), lastError: null, status: "active" }).where(eq(integrationAccounts.id, acc.id));
      return { exercises: 0, weights: 0, rev };
    }
    const w = await latestWeight(db, personId);
    const mapped = mapOpenGymState(state, w?.kg ?? 75);
    const dates = new Set<string>();
    if (mapped.exercises.length) {
      const rows = await db
        .insert(exerciseLogs)
        .values(mapped.exercises.map((e) => ({ personId, date: e.date, startedAt: e.startedAt, name: e.name, durationMin: e.durationMin, kcal: e.kcal, volumeKg: e.volumeKg, sets: e.sets, source: "opengym", externalId: e.externalId, activityCode: "strength_moderate" })))
        .onConflictDoUpdate({
          target: [exerciseLogs.personId, exerciseLogs.source, exerciseLogs.externalId],
          targetWhere: sql`${exerciseLogs.externalId} is not null`,
          set: { name: sql`excluded.name`, durationMin: sql`excluded.duration_min`, kcal: sql`excluded.kcal`, volumeKg: sql`excluded.volume_kg`, sets: sql`excluded.sets`, updatedAt: new Date() },
        })
        .returning({ date: exerciseLogs.date });
      rows.forEach((r) => dates.add(r.date));
    }
    if (mapped.weights.length) {
      await db
        .insert(weightLogs)
        .values(mapped.weights.map((x) => ({ personId, date: x.date, measuredAt: x.measuredAt, kg: x.kg, source: "opengym", externalId: x.externalId })))
        .onConflictDoNothing();
    }
    for (const d of dates) await recomputeDay(db, personId, d);
    await db.update(integrationAccounts).set({ lastSyncAt: new Date(), lastError: null, status: "active", meta: { ...acc.meta, rev } }).where(eq(integrationAccounts.id, acc.id));
    return { exercises: mapped.exercises.length, weights: mapped.weights.length, rev };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(integrationAccounts).set({ lastError: msg, status: /caducado|401/.test(msg) ? "reauth" : "error" }).where(eq(integrationAccounts.id, acc.id));
    throw e;
  }
}

/** Pair with an openGym instance (one-time code) and store the encrypted token. */
export async function pairOpenGym(db: Database, input: { userId: string; personId: string; baseUrl: string; code: string }, f?: typeof fetch) {
  const client = new OpenGymClient(input.baseUrl, undefined, f);
  const token = await client.redeem(input.code);
  const [acc] = await db
    .insert(integrationAccounts)
    .values({ userId: input.userId, personId: input.personId, provider: "opengym", baseUrl: input.baseUrl.replace(/\/$/, ""), credentialsEnc: encrypt(token), webhookSecretEnc: encrypt(newToken("whs").token), status: "active" })
    .returning();
  return acc!;
}

/* ------------------------------- store crawl ------------------------------ */

/** Crawl a store catalogue into foods(source=store) + today's prices. */
export async function crawlStore(db: Database, storeCode: string, opts: { warehouse?: string; limit?: number } = {}) {
  const make = STORE_PROVIDERS[storeCode];
  if (!make) throw new Error(`Tienda no soportada: ${storeCode}`);
  const provider = make();
  const [store] = await db.select().from(stores).where(eq(stores.code, storeCode)).limit(1);
  if (!store) throw new Error(`Tienda ${storeCode} no sembrada`);
  const today = todayIn();
  let n = 0;
  let batch: StoreProduct[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const rows = await upsertFoods(
      db,
      batch.map((p) => ({
        source: "store",
        sourceId: `${storeCode}:${p.id}`,
        barcode: p.barcode ?? null,
        kind: "food",
        name: p.name,
        nameEs: p.name,
        brand: p.brand ?? null,
        quantityLabel: p.packSize ?? null,
        imageUrl: p.imageUrl ?? null,
        nutrients: {},
        density: 1,
        nutriscore: null,
        nova: null,
        ecoscore: null,
        additives: [],
        allergens: [],
        traces: [],
        categories: p.category ? [p.category] : [],
        labels: [],
        ingredientsText: null,
        countries: ["en:spain"],
        completeness: 0,
        servings: [],
      })),
    );
    const ids = new Map(rows.map((r) => [r.sourceId, r.id]));
    await db.insert(prices).values(
      batch.map((p) => ({ foodId: ids.get(`${storeCode}:${p.id}`) ?? null, barcode: p.barcode ?? null, storeId: store.id, price: p.price.toFixed(2), pricePerKg: p.pricePerKg != null ? p.pricePerKg.toFixed(2) : null, packGrams: p.packGrams ?? null, source: "store", observedOn: today })),
    );
    n += batch.length;
    batch = [];
  };
  for await (const p of provider.crawl({ warehouse: opts.warehouse })) {
    batch.push(p);
    if (batch.length >= 200) await flush();
    if (opts.limit && n + batch.length >= opts.limit) break;
  }
  await flush();
  return n;
}
