import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import type { PgBoss } from "pg-boss";
import {
  aiEstimates,
  and,
  diaryEntries,
  eq,
  foods,
  integrationAccounts,
  isNull,
  lt,
  mealDrafts,
  notifications,
  personAccess,
  persons,
  session,
  sql,
  weightLogs,
  type Database,
} from "@nutria/db";
import { createProvider, structureRecipe, translateFoodNames } from "@nutria/ai";
import {
  crawlStore,
  deliverWebhook,
  evaluateAchievements,
  expiryCheck,
  exportPerson,
  generateMedicationDoses,
  importCiqualRows,
  importOffDump,
  JOBS,
  notify,
  recomputeDay,
  recomputeTargets,
  rowsOf,
  remindersTick,
  runCorrelations,
  runImport,
  scoreChallenge,
  syncOpenGym,
  toCsv,
  uploadDir,
  weeklyAdaptiveTdee,
  weeklyBulkReview,
  notifyLeanMass,
  buildWeeklyReport,
  photoReminders,
  type JobName,
  type JobPayloads,
  assignFoodGroups,
  shareReceipt,
  checkDisk,
} from "@nutria/core";
import { CIQUAL_ZIP_FALLBACK_URL, CIQUAL_ZIP_URL, decodeLatin1, extractVideo, parseCiqual } from "@nutria/integrations";
import { log } from "./log";

interface Ctx {
  db: Database;
  boss: PgBoss;
  signal: AbortSignal;
}
type Handler<N extends JobName> = (data: JobPayloads[N], ctx: Ctx) => Promise<unknown>;
type Handlers = { [N in JobName]: Handler<N> };

const OFF_DUMP_URL = "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz";

/** Persons that have an account (self) — used for personal jobs like weekly reports. */
async function selfPersons(db: Database) {
  return db.select({ id: persons.id, userId: persons.userId, timezone: persons.timezone }).from(persons).where(sql`${persons.userId} is not null`);
}

/** Every person with at least one weigh-in (needed for TDEE). */
async function personsWithWeight(db: Database) {
  return db.selectDistinct({ id: weightLogs.personId }).from(weightLogs);
}

const aiAvailable = () => {
  try {
    return createProvider();
  } catch {
    return null;
  }
};

export const handlers: Handlers = {
  [JOBS.recomputeDay]: async ({ personId, date }, { db }) => recomputeDay(db, personId, date),

  [JOBS.targetsRecompute]: async ({ personId }, { db }) => recomputeTargets(db, personId),

  [JOBS.tdeeWeekly]: async ({ personId }, { db }) => {
    const ids = personId ? [{ id: personId }] : await personsWithWeight(db);
    let n = 0;
    for (const p of ids) if (await weeklyAdaptiveTdee(db, p.id).catch((e) => log.warn("tdee", { personId: p.id, error: String(e) }))) n++;
    return { persons: n };
  },

  [JOBS.bulkWeekly]: async ({ personId }, { db }) => {
    const ids = personId ? [{ id: personId }] : await personsWithWeight(db);
    let n = 0;
    let lean = 0;
    for (const p of ids) {
      if (await weeklyBulkReview(db, p.id).catch((e) => log.warn("volumen", { personId: p.id, error: String(e) }))) n++;
      if (await notifyLeanMass(db, p.id).catch((e) => log.warn("masa magra", { personId: p.id, error: String(e) }))) lean++;
    }
    return { persons: n, leanMassAlerts: lean };
  },

  [JOBS.weeklyReport]: async ({ personId }, { db, boss }) => {
    const provider = aiAvailable();
    if (!provider) return { skipped: "sin IA configurada" };
    const list = personId ? (await selfPersons(db)).filter((p) => p.id === personId) : await selfPersons(db);
    let n = 0;
    for (const p of list) {
      try {
        const r = await buildWeeklyReport(db, p.id, provider);
        if (!r) continue;
        for (const h of r.webhooks) await boss.send(JOBS.webhookDeliver, h);
        n++;
      } catch (e) {
        log.warn("informe semanal", { personId: p.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { reports: n };
  },

  [JOBS.remindersTick]: async (_d, { db }) => ({ sent: await remindersTick(db) }),
  [JOBS.medicationDoses]: async (_d, { db }) => ({ created: await generateMedicationDoses(db) }),
  [JOBS.expiryCheck]: async (_d, { db }) => ({ sent: await expiryCheck(db), photos: await photoReminders(db) }),

  [JOBS.opengymSync]: async ({ accountId, force }, { db }) => syncOpenGym(db, accountId, undefined, { force }),
  [JOBS.opengymSyncAll]: async (_d, { db, boss }) => {
    const accs = await db.select({ id: integrationAccounts.id }).from(integrationAccounts).where(and(eq(integrationAccounts.provider, "opengym"), eq(integrationAccounts.status, "active")));
    for (const a of accs) await boss.send(JOBS.opengymSync, { accountId: a.id }, { singletonKey: a.id, singletonSeconds: 90 } as never);
    return { queued: accs.length };
  },

  [JOBS.offMirror]: async ({ url, countries }, { db, signal }) => {
    const r = await fetch(url ?? process.env.OFF_DUMP_URL ?? OFF_DUMP_URL, { headers: { "User-Agent": process.env.OFF_USER_AGENT ?? "Nutria/0.1" }, signal });
    if (!r.ok || !r.body) throw new Error(`Descarga OFF ${r.status}`);
    let last = 0;
    return importOffDump(db, r.body, {
      gzip: (url ?? OFF_DUMP_URL).endsWith(".gz"),
      countries: countries ?? (process.env.OFF_COUNTRIES ?? "en:spain").split(","),
      onProgress: (seen, kept) => {
        if (seen - last > 250_000) {
          last = seen;
          log.info("off mirror", { seen, kept });
        }
      },
    });
  },

  [JOBS.offRefreshProduct]: async ({ barcode }, { db }) => {
    const { foodByBarcode } = await import("@nutria/core");
    const f = await foodByBarcode(db, barcode);
    return { found: !!f };
  },

  [JOBS.ciqualImport]: async ({ url, force }, { db, boss, signal }) => {
    // Scheduled daily so a fresh install loads it as soon as ANSES is reachable; skip once loaded.
    if (!force) {
      const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(foods).where(eq(foods.source, "ciqual"));
      if ((c?.n ?? 0) > 1000) return { skipped: "ya importado", foods: c!.n };
    }
    let r = await fetch(url ?? CIQUAL_ZIP_URL, { signal });
    if (!r.ok && !url) r = await fetch(CIQUAL_ZIP_FALLBACK_URL, { signal });
    if (!r.ok) throw new Error(`Descarga CIQUAL ${r.status}`);
    const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
    const pick = (prefix: string) => {
      const k = Object.keys(files).find((n) => n.toLowerCase().split("/").pop()!.startsWith(prefix));
      if (!k) throw new Error(`CIQUAL: falta ${prefix}`);
      return decodeLatin1(files[k]!);
    };
    const rows = parseCiqual({ alim: pick("alim_2"), constituents: pick("const"), compo: pick("compo"), groups: pick("alim_grp") });
    const n = await importCiqualRows(db, rows);
    await boss.send(JOBS.translateFoods, {});
    return { foods: n };
  },

  [JOBS.translateFoods]: async ({ batchSize, usedOnly }, { db }) => {
    const provider = aiAvailable();
    if (!provider) return { skipped: "sin IA configurada" };
    const admin = await db.execute<{ id: string }>(sql`select id from "user" where role = 'admin' order by created_at limit 1`);
    const adminId = rowsOf<{ id: string }>(admin)[0]?.id;
    if (!adminId) return { skipped: "sin admin" };
    let done = 0;
    // First the foods people actually use (any source: OFF products can be named in any language);
    // diary entries keep a copy of the name, so the untouched copies are renamed too.
    for (let round = 0; round < 5; round++) {
      const used = rowsOf<{ id: string; name: string }>(
        await db.execute(sql`
          select f.id, f.name from foods f
          where f.name_es is null and (
            exists (select 1 from diary_entries d where d.food_id = f.id)
            or exists (select 1 from recipe_ingredients r where r.food_id = f.id)
            or exists (select 1 from food_favorites v where v.food_id = f.id))
          limit 40`),
      );
      if (!used.length) break;
      const out = await translateFoodNames({ db, userId: adminId, provider }, used);
      const old = new Map(used.map((u) => [u.id, u.name]));
      for (const t of out) {
        await db.update(foods).set({ nameEs: t.nameEs }).where(eq(foods.id, t.id));
        if (t.nameEs !== old.get(t.id)) await db.update(diaryEntries).set({ name: t.nameEs }).where(and(eq(diaryEntries.foodId, t.id), eq(diaryEntries.name, old.get(t.id)!)));
      }
      done += out.length;
      if (out.length === 0) break;
    }
    if (usedOnly) return { translated: done };
    for (let round = 0; round < 20; round++) {
      const pending = await db.select({ id: foods.id, name: foods.name }).from(foods).where(and(eq(foods.source, "ciqual"), isNull(foods.nameEs))).limit(batchSize ?? 80);
      if (!pending.length) break;
      const out = await translateFoodNames({ db, userId: adminId, provider }, pending);
      for (const t of out) await db.update(foods).set({ nameEs: t.nameEs }).where(eq(foods.id, t.id));
      done += out.length;
      if (out.length === 0) break;
    }
    return { translated: done };
  },

  [JOBS.storeCrawl]: async ({ store }, { db }) => ({ products: await crawlStore(db, store ?? "mercadona", { warehouse: process.env.MERCADONA_WAREHOUSE }) }),

  [JOBS.gamification]: async ({ personId }, { db }) => {
    const list = personId ? [{ id: personId }] : await db.select({ id: persons.id }).from(persons);
    let unlocked = 0;
    for (const p of list) {
      const got = await evaluateAchievements(db, p.id);
      unlocked += got.length;
      if (got.length) {
        const owners = await db.select({ userId: personAccess.userId }).from(personAccess).where(and(eq(personAccess.personId, p.id), sql`${personAccess.role} in ('owner','manager')`));
        for (const o of owners) await notify(db, { userId: o.userId, type: "challenge", title: `🏆 ¡Nuevo logro${got.length > 1 ? "s" : ""}!`, url: "/retos" });
      }
    }
    const active = await db.execute<{ id: string }>(sql`select id from challenges where start_date <= current_date and end_date >= current_date - 1`);
    for (const c of rowsOf<{ id: string }>(active)) await scoreChallenge(db, c.id);
    return { unlocked };
  },

  [JOBS.correlations]: async ({ personId }, { db }) => {
    const provider = aiAvailable() ?? undefined;
    const list = personId ? (await selfPersons(db)).filter((p) => p.id === personId) : await selfPersons(db);
    let found = 0;
    for (const p of list) found += (await runCorrelations(db, { personId: p.id, userId: p.userId!, provider, explain: !!provider })).length;
    return { found };
  },

  [JOBS.importDiary]: async ({ importId }, { db }) => runImport(db, importId),

  [JOBS.exportData]: async ({ userId, personId, format }, { db }) => {
    const data = await exportPerson(db, personId);
    const dir = join(uploadDir(), "exports", userId);
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const file = join(dir, `nutria-${personId}-${stamp}.${format}`);
    const body = format === "json" ? JSON.stringify(data, null, 2) : Object.entries(data).map(([k, rows]) => `# ${k}\n${toCsv(rows as Record<string, unknown>[])}`).join("\n\n");
    await writeFile(file, body);
    await notify(db, { userId, type: "plan_ready", title: "📦 Tu exportación está lista", url: `/ajustes/datos?descargar=${encodeURIComponent(`${personId}-${stamp}.${format}`)}` });
    return { file };
  },

  [JOBS.webhookDeliver]: async ({ webhookId, event, payload }, { db }) => {
    const status = await deliverWebhook(db, webhookId, event, payload);
    if (status < 200 || status >= 300) throw new Error(`Webhook respondió ${status}`); // pg-boss reintenta con backoff
    return { status };
  },

  [JOBS.recipeFromVideo]: async ({ estimateId, url, userId }, { db }) => {
    const provider = createProvider();
    try {
      const v = await extractVideo(url);
      const text = [`Título: ${v.title}`, v.uploader ? `Autor: ${v.uploader}` : null, `Descripción:\n${v.description}`, v.transcript ? `Transcripción:\n${v.transcript}` : null].filter(Boolean).join("\n\n");
      const r = await structureRecipe({ db, userId, provider }, { text, sourceUrl: v.webpageUrl, sourceType: "video", imageUrl: v.thumbnail, estimateId });
      await notify(db, { userId, type: "plan_ready", title: `🎬 Receta lista: ${r.title}`, url: `/recetas/importar?estimacion=${estimateId}` });
      return { title: r.title };
    } catch (e) {
      await db.update(aiEstimates).set({ status: "failed", error: e instanceof Error ? e.message : String(e) }).where(eq(aiEstimates.id, estimateId));
      throw e;
    }
  },

  [JOBS.foodGroups]: async (_d, { db }) => ({ foods: await assignFoodGroups(db) }),

  [JOBS.openPricesShare]: async ({ receiptId }, { db }) => shareReceipt(db, receiptId),

  [JOBS.cleanup]: async (_d, { db }) => {
    const ago = (d: number) => new Date(Date.now() - d * 86_400_000);
    const n1 = await db.delete(notifications).where(lt(notifications.createdAt, ago(90))).returning({ id: notifications.id });
    const n2 = await db.delete(aiEstimates).where(and(sql`${aiEstimates.status} in ('discarded','failed','pending')`, lt(aiEstimates.createdAt, ago(30)))).returning({ id: aiEstimates.id });
    const n3 = await db.delete(session).where(lt(session.expiresAt, new Date())).returning({ id: session.id });
    // Meal drafts nobody finished in a month: rows and their encrypted photos.
    const n4 = await db.delete(mealDrafts).where(lt(mealDrafts.updatedAt, ago(30))).returning({ id: mealDrafts.id, personId: mealDrafts.personId });
    for (const d of n4) await rm(join(uploadDir(), "meal-drafts", d.personId, d.id), { recursive: true, force: true });
    return { notifications: n1.length, estimates: n2.length, sessions: n3.length, mealDrafts: n4.length };
  },

  [JOBS.disk]: async (_d, { db }) => {
    const s = await checkDisk(db);
    return { usedPct: s.usedPct, level: s.level };
  },
};
