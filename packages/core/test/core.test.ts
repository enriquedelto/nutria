import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aiEstimates,
  and,
  gte,
  lte,
  dailySummaries,
  diaryEntries,
  eq,
  exerciseLogs,
  foods,
  getPersonAccess,
  getPersonAccessMany,
  imports,
  insights,
  mealSlots,
  medicationDoses,
  medications,
  notifications,
  notificationPrefs,
  personAccess,
  prices,
  personAchievements,
  persons,
  symptomLogs,
  targetSets,
  user,
  webhooks,
  tdeeEstimates,
  weightLogs,
  sleepLogs,
  type Database,
} from "@nutria/db";
import { createTestDb } from "@nutria/db/testing";
import { seedReference } from "@nutria/db/seed";
import { encrypt, hmacSha256 } from "@nutria/integrations";

process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const core = await import("../src");

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Database;
let personId: string;
const uid = "admin1";

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Database;
  await seedReference(db as never);
  await db.insert(user).values({ id: uid, name: "Enrique Delto", email: "e@example.com" });
  await core.onUserCreated(db, { id: uid, name: "Enrique Delto", email: "e@example.com" }, null, { firstUser: true });
  const [p] = await db.select().from(persons).where(eq(persons.userId, uid));
  personId = p!.id;
  await db.update(persons).set({ sex: "male", birthDate: "1990-01-01", heightCm: 180, activityLevel: "moderate", goalType: "lose", weeklyRateKg: -0.5 }).where(eq(persons.id, personId));
  await db.insert(weightLogs).values({ personId, date: "2026-11-01", kg: 85 });
});
afterAll(async () => t?.close());

describe("cuentas", () => {
  it("el primer usuario es admin y tiene persona, grupo, acceso y comidas", async () => {
    const [u] = await db.select().from(user).where(eq(user.id, uid));
    expect(u?.role).toBe("admin");
    const acc = await db.select().from(personAccess).where(eq(personAccess.userId, uid));
    expect(acc[0]?.role).toBe("owner");
    expect((await db.select().from(mealSlots).where(eq(mealSlots.personId, personId))).length).toBe(5);
  });
  it("invitación por token: válida una vez", async () => {
    const { token } = await core.createInvitation(db, { email: "Ana@Example.com", invitedBy: uid });
    expect(await core.findInvitation(db, token, "ana@example.com")).not.toBeNull();
    expect(await core.findInvitation(db, token, "otra@example.com")).toBeNull();
    const inv = await core.findInvitation(db, token);
    await db.insert(user).values({ id: "ana", name: "Ana", email: "ana@example.com" });
    await core.onUserCreated(db, { id: "ana", name: "Ana", email: "ana@example.com" }, inv);
    expect(await core.findInvitation(db, token)).toBeNull();
  });
});

describe("profesional", () => {
  it("la invitación de profesional da acceso de solo lectura que caduca a los días pedidos", async () => {
    const { token } = await core.createInvitation(db, { email: "nutri@example.com", invitedBy: uid, personId, accessRole: "professional", scopes: ["diary"], accessDays: 30 });
    const inv = await core.findInvitation(db, token);
    await db.insert(user).values({ id: "nutri", name: "Nutri", email: "nutri@example.com" });
    await core.onUserCreated(db, { id: "nutri", name: "Nutri", email: "nutri@example.com" }, inv);
    const [a] = await db.select().from(personAccess).where(eq(personAccess.userId, "nutri"));
    expect(a?.role).toBe("professional");
    expect(a?.canWrite).toBe(false);
    const days = (a!.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    // Sin persona propia ni hogar.
    expect(await db.select().from(persons).where(eq(persons.userId, "nutri"))).toHaveLength(0);
  });
  it("permisos en lote: mismo resultado que uno a uno", async () => {
    const all = (await db.select({ id: persons.id }).from(persons)).map((p) => p.id);
    for (const u of [uid, "nutri", "ana"]) {
      const many = await getPersonAccessMany(db, u, all);
      for (const pid of all) {
        const one = await getPersonAccess(db, u, pid);
        const got = many.get(pid) ?? null;
        expect(got && { ...got, scopes: [...got.scopes].sort() }).toEqual(one && { ...one, scopes: [...one.scopes].sort() });
      }
    }
    expect((await getPersonAccessMany(db, uid, [])).size).toBe(0);
  });
});

describe("objetivos", () => {
  it("calcula objetivos y respeta el modo fijo", async () => {
    const t1 = await core.recomputeTargets(db, personId);
    expect(t1!.kcal).toBeGreaterThan(1800);
    expect(t1!.kcal).toBeLessThan(2800);
    expect(t1!.micros.iron?.min).toBeGreaterThan(0);
    await db.update(targetSets).set({ mode: "fixed", kcal: 1999 }).where(eq(targetSets.id, t1!.id));
    const t2 = await core.recomputeTargets(db, personId);
    expect(t2!.kcal).toBe(1999);
    // «Recalcular» explícito (force): vuelve a calcular y deja el modo en calculado.
    const t3 = await core.recomputeTargets(db, personId, { force: true });
    expect(t3!.kcal).toBe(t1!.kcal);
    expect(t3!.mode).toBe("dynamic");
  });
  it("dice qué falta del perfil (el peso cuenta)", async () => {
    expect(await core.missingProfileFields(db, personId)).toEqual([]);
    const [p] = await db.insert(persons).values({ displayName: "Sin datos" }).returning();
    expect(await core.missingProfileFields(db, p!.id)).toEqual(["sexo", "fecha de nacimiento", "altura", "peso"]);
    expect(await core.recomputeTargets(db, p!.id)).toBeNull();
    await db.delete(persons).where(eq(persons.id, p!.id));
  });
  it("en modo adaptativo usa el TDEE real reciente aunque se recalcule por un cambio de perfil", async () => {
    const t1 = await core.recomputeTargets(db, personId);
    await db.update(targetSets).set({ mode: "adaptive" }).where(eq(targetSets.id, t1!.id));
    const today = new Date().toISOString().slice(0, 10);
    await db.insert(tdeeEstimates).values({ personId, date: today, formulaTdee: 2700, adaptiveTdee: 3200, confidence: 1, windowDays: 28, loggedDays: 28, underLoggingSuspected: false, suggestedKcal: 2700 });
    const t2 = await core.recomputeTargets(db, personId);
    expect(t2!.source).toBe("adaptive");
    expect(t2!.kcal).toBeGreaterThan(t1!.kcal);
    await db.delete(tdeeEstimates).where(eq(tdeeEstimates.personId, personId));
    await db.update(targetSets).set({ mode: "dynamic" }).where(eq(targetSets.id, t1!.id));
    await core.recomputeTargets(db, personId);
  });
});

describe("diario", () => {
  let foodId: string;
  it("añade con snapshot y recalcula el día", async () => {
    const [f] = await db.insert(foods).values({ source: "custom", name: "Arroz cocido", kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, nutrients: { energy_kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, iron: 0.2 }, nova: 1 }).returning();
    foodId = f!.id;
    const rows = await core.addEntries(db, { personId, userId: uid, date: "2026-11-02", mealSlot: "lunch", origin: "manual", items: [{ foodId, grams: 200, clientId: "c1" }] });
    expect(rows[0]!.kcal).toBeCloseTo(260);
    const again = await core.addEntries(db, { personId, userId: uid, date: "2026-11-02", mealSlot: "lunch", origin: "manual", items: [{ foodId, grams: 200, clientId: "c1" }] });
    expect(again).toHaveLength(0); // idempotente por clientId
    const [s] = await db.select().from(dailySummaries).where(eq(dailySummaries.personId, personId));
    expect(s?.kcal).toBeCloseTo(260);
    expect(s?.entries).toBe(1);
  });
  it("editar gramos reescala y bloquear valores se mantiene", async () => {
    const [e] = await db.select().from(diaryEntries).where(eq(diaryEntries.clientId, "c1"));
    const u = await core.updateEntry(db, personId, e!.id, { grams: 100, lockedValues: { protein: 5 } });
    expect(u!.kcal).toBeCloseTo(130);
    expect(u!.protein).toBeCloseTo(5);
    const u2 = await core.updateEntry(db, personId, e!.id, { grams: 300 });
    expect(u2!.protein).toBeCloseTo(15);
  });
  it("cambiar una entrada por otro alimento mantiene los gramos y descarta correcciones", async () => {
    const [e] = await db.select().from(diaryEntries).where(eq(diaryEntries.clientId, "c1"));
    const [soja] = await db.insert(foods).values({ source: "custom", name: "Bebida de soja sin azúcar", brand: "Marca", kcal: 33, protein: 3.3, carbs: 0.2, fat: 1.9, nutrients: { energy_kcal: 33, protein: 3.3, carbs: 0.2, fat: 1.9, calcium: 120 }, nova: 3 }).returning();
    const u = await core.updateEntry(db, personId, e!.id, { foodId: soja!.id });
    expect(u).toMatchObject({ foodId: soja!.id, name: "Bebida de soja sin azúcar", brand: "Marca", grams: 300, lockedValues: {}, nova: 3 });
    expect(u!.kcal).toBeCloseTo(99);
    expect(u!.protein).toBeCloseTo(9.9);
    expect(u!.nutrients.calcium).toBeCloseTo(360);
    const [s] = await db.select().from(dailySummaries).where(and(eq(dailySummaries.personId, personId), eq(dailySummaries.date, "2026-11-02")));
    expect(s?.kcal).toBeCloseTo(99);
    // Back to rice with explicit grams.
    const back = await core.updateEntry(db, personId, e!.id, { foodId, grams: 100 });
    expect(back!.kcal).toBeCloseTo(130);
  });
  it("al cambiar los gramos de una ración se quita la etiqueta de la ración", async () => {
    const [row] = await core.addEntries(db, { personId, userId: uid, date: "2026-11-04", mealSlot: "breakfast", origin: "manual", items: [{ name: "Pan", grams: 40, servingLabel: "1 rebanada", servingQty: 1, per100: { energy_kcal: 265 } }] });
    const moved = await core.updateEntry(db, personId, row!.id, { mealSlot: "lunch" });
    expect(moved).toMatchObject({ servingLabel: "1 rebanada", mealSlot: "lunch" });
    const u = await core.updateEntry(db, personId, row!.id, { grams: 80 });
    expect(u).toMatchObject({ grams: 80, servingLabel: null, servingQty: null });
    expect(u!.kcal).toBeCloseTo(212);
  });
  it("confirmar propuesta de IA y deshacer", async () => {
    const [est] = await db.insert(aiEstimates).values({ userId: uid, personId, kind: "meal" }).returning();
    await core.addEntries(db, { personId, userId: uid, date: "2026-11-03", mealSlot: "dinner", origin: "ai_text", estimateId: est!.id, items: [{ name: "Tortilla", grams: 150, per100: { energy_kcal: 190, protein: 6.5 } }] });
    const { aiActions } = await import("@nutria/db");
    const [act] = await db.select().from(aiActions).where(eq(aiActions.estimateId, est!.id));
    expect(await core.undoAiAction(db, uid, act!.id)).toBe(true);
    expect(await core.undoAiAction(db, uid, act!.id)).toBe(false);
    const left = await db.select().from(diaryEntries).where(eq(diaryEntries.date, "2026-11-03"));
    expect(left).toHaveLength(0);
    const [e2] = await db.select().from(aiEstimates).where(eq(aiEstimates.id, est!.id));
    expect(e2?.status).toBe("discarded");
  });
  it("copiar comida a otro día", async () => {
    const rows = await core.copyMeal(db, { personId, userId: uid, fromDate: "2026-11-02", toDate: "2026-11-04", fromSlot: "lunch" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clientId).toBeNull();
  });
});

describe("openGym", () => {
  /** Fake openGym server: mutable state, request log, configurable token behaviour. */
  function fakeOpenGym() {
    const o = {
      rev: 3,
      token: "tok",
      renew: null as string | null,
      calls: [] as string[],
      state: {
        unit: "kg",
        workouts: [
          { id: "w1", d: "2026-11-02", start: 0, end: 3_600_000, name: "Torso", vol: 8000, entries: [{ id: "1436", sets: [{ w: 80, r: 8 }] }] },
          { id: "w2", d: "2026-11-02", start: 7_200_000, end: 9_000_000, name: "Extra", vol: 1000, entries: [] },
        ],
        bodyweight: [{ d: "2026-11-02", w: 84.2, t: 1 }],
        week: { "1": ["r1"], "3": ["r2"], "6": [] },
      } as Record<string, unknown> & { workouts: unknown[]; bodyweight: { d: string; w: number; t: number }[] },
      fetch: (async (url: string, init?: RequestInit) => {
        const path = String(url).replace("http://og", "");
        o.calls.push(path);
        if ((init?.headers as Record<string, string>).Authorization !== `Bearer ${o.token}`) return new Response("{}", { status: 401 });
        if (path === "/api/me") return Response.json({ user: { name: "Ana" }, ...(o.renew ? { token: o.renew } : {}) });
        if (path === "/api/data/rev") return Response.json({ rev: o.rev, wid: "x" });
        if (path === "/api/data") return Response.json({ rev: o.rev, state: o.state });
        return new Response("{}", { status: 404 });
      }) as unknown as typeof fetch,
    };
    return o;
  }
  async function ogAccount(meta: Record<string, unknown> = {}) {
    const { integrationAccounts } = await import("@nutria/db");
    await db.delete(integrationAccounts).where(eq(integrationAccounts.personId, personId));
    const [acc] = await db.insert(integrationAccounts).values({ userId: uid, personId, provider: "opengym", baseUrl: "http://og", credentialsEnc: encrypt("tok"), status: "active", meta }).returning();
    return acc!;
  }
  const ogLogs = () => db.select().from(exerciseLogs).where(and(eq(exerciseLogs.personId, personId), eq(exerciseLogs.source, "opengym")));
  const ogWeights = () => db.select().from(weightLogs).where(and(eq(weightLogs.personId, personId), eq(weightLogs.source, "opengym")));

  it("sincroniza entrenos y pesajes sin duplicar, con sus ejercicios", async () => {
    const og = fakeOpenGym();
    const acc = await ogAccount();
    const r1 = await core.syncOpenGym(db, acc.id, og.fetch);
    expect(r1).toMatchObject({ exercises: 2, weights: 1, fetched: true, rev: 3 });
    expect(og.calls).toEqual(["/api/me", "/api/data/rev", "/api/data"]);
    og.rev = 4;
    await core.syncOpenGym(db, acc.id, og.fetch);
    const logs = await ogLogs();
    expect(logs).toHaveLength(2);
    expect(logs.find((l) => l.externalId === "w1")!.details).toMatchObject({ exercises: [{ name: "Sentadilla con barra alta", sets: [{ kg: 80, reps: 8 }] }] });
    expect(await ogWeights()).toHaveLength(1);
    const [s] = await db.select().from(dailySummaries).where(and(eq(dailySummaries.personId, personId), eq(dailySummaries.date, "2026-11-02")));
    expect(s?.exerciseKcal).toBeGreaterThan(100);
    const { integrationAccounts } = await import("@nutria/db");
    const [a] = await db.select().from(integrationAccounts).where(eq(integrationAccounts.id, acc.id));
    expect(a!.meta).toMatchObject({ rev: 4, workouts: 2, weighIns: 1, name: "Ana", plannedDays: [1, 3] });
  });

  it("si la revisión no cambia no descarga el documento", async () => {
    const og = fakeOpenGym();
    const acc = await ogAccount({ meCheckedAt: Date.now(), rev: 3 });
    const r = await core.syncOpenGym(db, acc.id, og.fetch);
    expect(r).toMatchObject({ fetched: false, rev: 3 });
    expect(og.calls).toEqual(["/api/data/rev"]);
    const forced = await core.syncOpenGym(db, acc.id, og.fetch, { force: true });
    expect(forced.fetched).toBe(true);
  });

  it("refleja borrados y correcciones hechos en openGym", async () => {
    const og = fakeOpenGym();
    const acc = await ogAccount({ meCheckedAt: Date.now() });
    await core.syncOpenGym(db, acc.id, og.fetch);
    og.state.workouts = og.state.workouts.slice(0, 1);
    og.state.bodyweight = [{ d: "2026-11-02", w: 83.6, t: 5 }];
    og.rev = 5;
    const r = await core.syncOpenGym(db, acc.id, og.fetch);
    expect(r.removed).toBe(1);
    expect((await ogLogs()).map((l) => l.externalId)).toEqual(["w1"]);
    const ws = await ogWeights();
    expect(ws).toHaveLength(1);
    expect(ws[0]!.kg).toBeCloseTo(83.6, 1);
    og.state.workouts = [];
    og.state.bodyweight = [];
    og.rev = 6;
    expect((await core.syncOpenGym(db, acc.id, og.fetch)).removed).toBe(2);
    expect(await ogLogs()).toHaveLength(0);
    expect(await ogWeights()).toHaveLength(0);
  });

  it("guarda el token renovado por openGym", async () => {
    const og = fakeOpenGym();
    og.renew = "tok-nuevo";
    const acc = await ogAccount();
    await core.syncOpenGym(db, acc.id, og.fetch);
    og.token = "tok-nuevo";
    og.rev = 9;
    await expect(core.syncOpenGym(db, acc.id, og.fetch)).resolves.toMatchObject({ fetched: true, rev: 9 });
  });

  it("con el token caducado pide volver a emparejar y avisa una sola vez", async () => {
    const og = fakeOpenGym();
    og.token = "otro";
    const acc = await ogAccount({ meCheckedAt: Date.now() });
    await expect(core.syncOpenGym(db, acc.id, og.fetch)).rejects.toThrow(/caducado/);
    await expect(core.syncOpenGym(db, acc.id, og.fetch)).rejects.toThrow(/caducado/);
    const { integrationAccounts } = await import("@nutria/db");
    const [a] = await db.select().from(integrationAccounts).where(eq(integrationAccounts.id, acc.id));
    expect(a!.status).toBe("reauth");
    const n = await db.select().from(notifications).where(and(eq(notifications.userId, uid), eq(notifications.type, "integration")));
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toBe("Vuelve a emparejar openGym");
  });
});

describe("recordatorios", () => {
  it("genera tomas del día y avisa cuando toca", async () => {
    await db.insert(medications).values({ personId, name: "Eutirox", substanceCode: "levothyroxine", dose: "50 µg", times: ["08:00"], withFood: "fasting" });
    const now = core.zonedTime("2026-11-05", "08:02", "Europe/Madrid");
    expect(await core.generateMedicationDoses(db, now)).toBe(1);
    expect(await core.generateMedicationDoses(db, now)).toBe(0);
    expect(await core.remindersTick(db, now)).toBeGreaterThanOrEqual(1);
    const n = await db.select().from(notifications).where(eq(notifications.type, "medication"));
    expect(n[0]?.title).toContain("Eutirox");
    expect(n[0]?.body).toContain("en ayunas");
    expect((await db.select().from(medicationDoses)).length).toBe(1);
  });
  it("zonedTime respeta el horario de invierno/verano", () => {
    expect(core.zonedTime("2026-01-15", "08:00", "Europe/Madrid").toISOString()).toBe("2026-01-15T07:00:00.000Z");
    expect(core.zonedTime("2026-07-15", "08:00", "Europe/Madrid").toISOString()).toBe("2026-07-15T06:00:00.000Z");
  });
});

describe("logros y correlaciones", () => {
  it("desbloquea el primer registro", async () => {
    const got = await core.evaluateAchievements(db, personId);
    expect(got).toContain("first_log");
    expect((await db.select().from(personAchievements).where(eq(personAchievements.personId, personId))).map((x) => x.achievementCode)).toContain("first_log");
  });
  it("detecta alimento → síntoma", async () => {
    const base = Date.parse("2026-09-01T13:00:00Z");
    for (let i = 0; i < 12; i++) {
      const at = new Date(base + i * 2 * 86_400_000);
      const date = at.toISOString().slice(0, 10);
      const dairy = i % 2 === 0;
      await db.insert(diaryEntries).values({ personId, date, mealSlot: "lunch", eatenAt: at, name: dairy ? "Queso fresco" : "Arroz blanco", grams: 100, kcal: 100 });
      if (dairy) await db.insert(symptomLogs).values({ personId, date, occurredAt: new Date(at.getTime() + 4 * 3_600_000), symptom: "bloating", intensity: 3 });
    }
    const found = await core.runCorrelations(db, { personId, userId: uid, days: 400 });
    expect(found[0]?.key).toContain("queso");
    const rows = await db.select().from(insights).where(eq(insights.kind, "symptom_correlation"));
    expect(rows[0]?.bodyMd).toContain("correlación");
  });
});

describe("datos", () => {
  it("importa el volcado TSV de OFF filtrando por país", async () => {
    const tsv = ["code\tproduct_name\tbrands\tcountries_tags\tenergy-kcal_100g\tproteins_100g", "8410000000001\tGalletas María\tMarca\ten:spain\t440\t7", "4000000000002\tKeks\tX\ten:germany\t450\t6"].join("\n");
    const r = await core.importOffDump(db, Readable.from([tsv]));
    expect(r).toEqual({ seen: 2, kept: 1, failed: 0 });
    const [f] = await db.select().from(foods).where(eq(foods.sourceId, "8410000000001"));
    expect(f?.kcal).toBe(440);
  });
  it("reimportar el mismo volcado no reescribe las filas sin cambios (sí las que cambian)", async () => {
    const head = "code\tproduct_name\tbrands\tcountries_tags\tenergy-kcal_100g\tproteins_100g";
    const row = (kcal: number) => `8410000000011\tPan integral\tMarca\ten:spain\t${kcal}\t9`;
    await core.importOffDump(db, Readable.from([[head, row(250)].join("\n")]));
    const first = (await db.select().from(foods).where(eq(foods.sourceId, "8410000000011")))[0]!;
    await new Promise((r) => setTimeout(r, 20));
    await core.importOffDump(db, Readable.from([[head, row(250)].join("\n")]));
    const same = (await db.select().from(foods).where(eq(foods.sourceId, "8410000000011")))[0]!;
    expect(same.updatedAt.getTime()).toBe(first.updatedAt.getTime());
    await core.importOffDump(db, Readable.from([[head, row(260)].join("\n")]));
    const changed = (await db.select().from(foods).where(eq(foods.sourceId, "8410000000011")))[0]!;
    expect(changed.kcal).toBe(260);
    expect(changed.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
  });
  it("un corte de la descarga del volcado es un error capturable, no tumba el proceso", async () => {
    const gz = gzipSync(["code\tproduct_name\tcountries_tags\tenergy-kcal_100g", "8410000000009\tCortado\ten:spain\t100"].join("\n"));
    const src = new Readable({ read() {} });
    src.push(gz.subarray(0, 10));
    setTimeout(() => src.destroy(new Error("other side closed")), 10);
    await expect(core.importOffDump(db, src, { gzip: true })).rejects.toThrow(/other side closed/);
  });
  it("rastreo de tienda: productos repetidos en varias categorías y dos pasadas el mismo día", async () => {
    const p = (id: string, price: number) => ({ id, name: `Producto ${id}`, price, url: `https://tienda/${id}` });
    const fake = { code: "mercadona", name: "Mercadona", product: async () => null, toCart: async () => ({ mode: "links" as const, lines: [] }), async *crawl() { yield p("1", 1.5); yield p("2", 2); yield p("1", 1.5); } };
    expect(await core.crawlStore(db, "mercadona", { provider: fake as never })).toBe(2);
    expect(await core.crawlStore(db, "mercadona", { provider: fake as never })).toBe(2);
    const rows = await db.select().from(prices).where(eq(prices.source, "store"));
    expect(rows).toHaveLength(2);
  });
  it("Open Prices: mediana €/kg en EUR, sin repetir si ya hay precio reciente y sin romper si la red falla", async () => {
    const [f] = await db.insert(foods).values({ source: "off", sourceId: "8410000000077", barcode: "8410000000077", name: "Garbanzos cocidos", kcal: 120, nutrients: { energy_kcal: 120 } }).returning();
    const items = [
      { price: 1.0, currency: "EUR", date: "2026-10-01", product: { product_quantity: 400, product_quantity_unit: "g" } },
      { price: 3.0, currency: "EUR", date: "2026-09-20", price_per: "KILOGRAM" },
      { price: 9.9, currency: "USD", date: "2026-09-01", product: { product_quantity: 400, product_quantity_unit: "g" } },
      { price: 1.4, currency: "EUR", date: "2026-08-01", product: { product_quantity: 0.4, product_quantity_unit: "kg" } },
    ];
    let calls = 0;
    const fake = (async (url: string) => { calls++; expect(url).toContain("product_code=8410000000077"); return new Response(JSON.stringify({ items })); }) as unknown as typeof fetch;
    expect(await core.refreshOpenPrices(db, [f!.id], fake)).toBe(1);
    const [row] = await db.select().from(prices).where(and(eq(prices.foodId, f!.id), eq(prices.source, "open_prices")));
    expect(Number(row?.pricePerKg)).toBe(3); // 2.5, 3, 3.5 → 3
    expect(row?.observedOn).toBe("2026-10-01");
    expect(await core.refreshOpenPrices(db, [f!.id], fake)).toBe(0);
    expect(calls).toBe(1);
    const broken = (async () => { throw new Error("sin red"); }) as unknown as typeof fetch;
    const [g] = await db.insert(foods).values({ source: "off", barcode: "8410000000078", name: "Lentejas", kcal: 110, nutrients: {} }).returning();
    expect(await core.refreshOpenPrices(db, [g!.id], broken)).toBe(0);
  });
  it("tolera valores fuera del rango de real (7e-47, 1e40)", async () => {
    const tsv = ["code\tproduct_name\tbrands\tcountries_tags\tenergy-kcal_100g\tproteins_100g\tsalt_100g", "8410000000003\tTofu raro\tMarca\ten:spain\t120\t7e-47\t1e40"].join("\n");
    const r = await core.importOffDump(db, Readable.from([tsv]));
    expect(r).toMatchObject({ kept: 1, failed: 0 });
    const [f] = await db.select().from(foods).where(eq(foods.sourceId, "8410000000003"));
    expect(f?.protein).toBe(0);
    expect(f?.salt).toBeNull();
  });
  it("importa CSV de Cronometer en el diario", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nutria-"));
    process.env.UPLOAD_DIR = dir;
    const [imp] = await db.insert(imports).values({ userId: uid, personId, source: "auto" }).returning();
    await mkdir(join(dir, "imports"), { recursive: true });
    await writeFile(core.importPath(imp!.id), "Day,Time,Group,Food Name,Amount,Energy (kcal),Protein (g),Carbs (g),Fat (g)\n2026-10-01,08:00,Breakfast,Oats,50 g,190,6.5,33,3.5\n");
    const stats = await core.runImport(db, imp!.id);
    expect(stats.entries).toBe(1);
    const again = await core.runImport(db, imp!.id);
    expect(again.entries).toBe(0);
  });
  it("exporta los datos de la persona", async () => {
    const out = await core.exportPerson(db, personId);
    expect(out.diario!.length).toBeGreaterThan(0);
    expect(core.toCsv([{ a: 'x,"y"', b: 1 }])).toBe('a,b\n"x,""y""",1');
  });
  it("webhook firmado", async () => {
    const [w] = await db.insert(webhooks).values({ userId: uid, url: "https://ha.local/hook", events: ["weight.logged"], secretEnc: encrypt("s3cret") }).returning();
    let sig = "";
    let body = "";
    const fake = (async (_u: string, init?: RequestInit) => {
      sig = (init!.headers as Record<string, string>)["X-Nutria-Signature"]!;
      body = String(init!.body);
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await core.deliverWebhook(db, w!.id, "weight.logged", { kg: 80 }, fake)).toBe(200);
    expect(sig).toBe(`sha256=${hmacSha256("s3cret", body)}`);
    expect((await core.webhooksFor(db, uid, "weight.logged")).length).toBe(1);
  });
});

describe("deporte y suplementos", () => {
  it("perfil deportivo: entreno/descanso con la misma media y agua automática", async () => {
    await core.saveSportProfile(db, personId, true, { level: "competitive", trainingDays: [1, 3, 5], trainingDaysSource: "manual", cycleCarbs: true, waterAuto: true });
    const base = await core.recomputeTargets(db, personId, { force: true });
    const kg = (await core.latestWeight(db, personId))!.kg;
    expect(base!.protein).toBe(Math.round(2 * kg));
    const mon = await core.targetsForDate(db, personId, "2030-01-07");
    const tue = await core.targetsForDate(db, personId, "2030-01-08");
    expect(mon!.dayKind).toBe("training");
    expect(tue!.dayKind).toBe("rest");
    expect(mon!.kcal).toBeGreaterThan(base!.kcal);
    expect(tue!.kcal).toBeLessThan(base!.kcal);
    expect(Math.abs(3 * mon!.kcal + 4 * tue!.kcal - 7 * base!.kcal)).toBeLessThanOrEqual(3);
    expect(mon!.protein).toBe(base!.protein);
    // In the past a planned day without a workout was a rest day; a logged workout makes it a training day.
    await db.insert(exerciseLogs).values({ personId, date: "2020-01-07", name: "Pierna", durationMin: 50, kcal: 300, source: "manual" });
    expect((await core.targetsForDate(db, personId, "2020-01-06"))!.dayKind).toBe("rest");
    expect((await core.targetsForDate(db, personId, "2020-01-07"))!.dayKind).toBe("training");
    expect(await core.waterGoalFor(db, personId, "2020-01-07")).toMatchObject({ auto: true, ml: Math.round((35 * kg + 500) / 250) * 250, dayKind: "training" });
    expect(await core.waterGoalFor(db, personId, "2020-01-06")).toMatchObject({ auto: true, ml: Math.round((35 * kg) / 250) * 250, dayKind: "rest" });
    // Without carb cycling every day uses the base target.
    await core.saveSportProfile(db, personId, true, { cycleCarbs: false });
    expect((await core.targetsForDate(db, personId, "2030-01-07"))!.kcal).toBe(base!.kcal);
  });

  it("días previstos de openGym salvo que se hayan puesto a mano", async () => {
    expect(core.plannedDaysFromWeek({ "0": ["a"], "1": ["b"], "3": [], "5": ["c"] })).toEqual([1, 5, 7]);
    expect(await core.applyPlannedDays(db, personId, [1, 2, 3, 4, 5])).toBe(false);
    await core.saveSportProfile(db, personId, true, { trainingDaysSource: "opengym" });
    expect(await core.applyPlannedDays(db, personId, [1, 2, 3, 4, 5])).toBe(true);
    expect((await core.getSportProfile(db, personId)).profile).toMatchObject({ trainingDays: [1, 2, 3, 4, 5], trainingDaysSource: "opengym", level: "competitive" });
  });

  it("pauta de creatina: tomar, racha, deshacer y recordatorio", async () => {
    const plan = await core.addSupplementPlan(db, personId, uid, { code: "creatine", dose: 5, doseUnit: "g", gramsPerDose: 5, times: ["09:00"], daysOfWeek: [1, 2, 3, 4, 5, 6, 7] });
    expect((await core.supplementFood(db, personId, uid, "creatine")).id).toBe(plan.foodId);
    await core.takeSupplement(db, personId, uid, plan.id, "2026-12-01");
    await core.takeSupplement(db, personId, uid, plan.id, "2026-12-01");
    await core.takeSupplement(db, personId, uid, plan.id, "2026-12-02");
    const day1 = await db.select().from(diaryEntries).where(and(eq(diaryEntries.personId, personId), eq(diaryEntries.date, "2026-12-01"), eq(diaryEntries.origin, "supplement")));
    expect(day1).toHaveLength(1);
    expect(day1[0]).toMatchObject({ grams: 5, kcal: 0, servingLabel: "5 g" });
    let [st] = await core.supplementsForDate(db, personId, "2026-12-02");
    expect(st).toMatchObject({ code: "creatine", taken: true, streak: 2, doseLabel: "5 g" });
    // time[] comes back as "HH:MM" (Postgres says "09:00:00"): the edit form re-sends it as is.
    expect(st!.times).toEqual(["09:00"]);
    await core.untakeSupplement(db, personId, plan.id, "2026-12-02");
    [st] = await core.supplementsForDate(db, personId, "2026-12-02");
    expect(st).toMatchObject({ taken: false, streak: 1 });
    // Reminder only when the dose is not logged yet.
    await core.remindersTick(db, core.zonedTime("2026-12-01", "09:02", "Europe/Madrid"));
    expect(await db.select().from(notifications).where(eq(notifications.type, "supplement"))).toHaveLength(0);
    await core.remindersTick(db, core.zonedTime("2026-12-03", "09:02", "Europe/Madrid"));
    expect(await db.select().from(notifications).where(eq(notifications.type, "supplement"))).toHaveLength(1);
  });

  it("la whey suma proteína al diario", async () => {
    const plan = await core.addSupplementPlan(db, personId, uid, { code: "whey", dose: 30, doseUnit: "g", gramsPerDose: 30, times: [], daysOfWeek: [1, 2, 3, 4, 5, 6, 7] });
    const e = await core.takeSupplement(db, personId, uid, plan.id, "2026-12-05");
    expect(e!.protein).toBeCloseTo(23.4, 1);
    expect(e!.kcal).toBeCloseTo(114, 0);
  });
});

describe("revisión del volumen", () => {
  it("dos semanas lentas proponen más kcal; al aplicarlo se mantiene tras recalcular", async () => {
    await db.insert(user).values({ id: "gym", name: "Gym", email: "gym@example.com" });
    await core.onUserCreated(db, { id: "gym", name: "Gym", email: "gym@example.com" }, null);
    const [p] = await db.select().from(persons).where(eq(persons.userId, "gym"));
    const pid = p!.id;
    await db.update(persons).set({ sex: "male", birthDate: "1995-01-01", heightCm: 178, activityLevel: "active", goalType: "gain", weeklyRateKg: 0.25 }).where(eq(persons.id, pid));
    const now = new Date();
    const day = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10);
    // 50 days up to a week from now: flat weight (no gain) and a full diary.
    for (let i = -42; i <= 7; i++) {
      await db.insert(weightLogs).values({ personId: pid, date: day(i), kg: 72 + (i % 2) * 0.1 });
      await db.insert(dailySummaries).values({ personId: pid, date: day(i), kcal: 2900, protein: 140, entries: 4, complete: true });
    }
    // Workouts: bench (chest + triceps/shoulders as secondary) getting stronger.
    const bench = (kg: number) => ({ exercises: [{ id: "0025", name: "Press de banca con barra", sets: [{ kg: 40, reps: 10, warmup: true }, { kg, reps: 8 }, { kg, reps: 8 }, { kg, reps: 8 }] }] });
    for (const [i, kg] of [[-30, 60], [-23, 60], [-16, 62.5], [-9, 65], [-4, 65], [-2, 67.5]] as const)
      await db.insert(exerciseLogs).values({ personId: pid, date: day(i), name: "Pecho", durationMin: 60, kcal: 300, details: bench(kg) });
    const t0 = await core.recomputeTargets(db, pid);

    const w1 = await core.weeklyBulkReview(db, pid, now);
    expect(w1).toMatchObject({ verdict: "slow", kcalDelta: 0 });
    expect(w1!.sets.find((s) => s.muscle === "pecho")!.week).toBe(6);
    expect(w1!.sets.find((s) => s.muscle === "triceps")!.week).toBe(3);
    expect(w1!.strengthChangePct).toBeGreaterThan(2);
    expect(w1!.signal.kind).toBe("stalled");
    expect(await db.select().from(notifications).where(eq(notifications.type, "bulk_review"))).toHaveLength(0);
    // Rebuilding the same week replaces it.
    await core.weeklyBulkReview(db, pid, now);
    expect(await db.select().from(insights).where(and(eq(insights.personId, pid), eq(insights.kind, "bulk_review")))).toHaveLength(1);

    const w2 = await core.weeklyBulkReview(db, pid, new Date(now.getTime() + 7 * 86_400_000));
    expect(w2).toMatchObject({ verdict: "slow", kcalDelta: 150 });
    expect(await db.select().from(notifications).where(eq(notifications.type, "bulk_review"))).toHaveLength(1);
    const latest = await core.latestBulkReview(db, pid);
    const t1 = await core.applyBulkReview(db, pid, latest!.id);
    expect(t1!.kcal).toBe(t0!.kcal + 150);
    expect(t1!.kcalAdjust).toBe(150);
    expect(await core.applyBulkReview(db, pid, latest!.id)).toBeNull(); // only once
    // A weigh-in recomputes the targets: the adjustment stays.
    expect((await core.recomputeTargets(db, pid))!.kcal).toBe(t0!.kcal + 150);
    // Manual targets move by the difference and stay manual.
    await db.update(targetSets).set({ mode: "fixed", kcal: 3000, carbs: 350 }).where(eq(targetSets.id, t1!.id));
    const t2 = await core.setKcalAdjust(db, pid, 0);
    expect(t2).toMatchObject({ mode: "fixed", kcal: 2850, kcalAdjust: 0 });
    expect(t2.carbs).toBe(313);
    // Not for other goals.
    expect(await core.weeklyBulkReview(db, personId, now)).toBeNull();
  });
});

describe("proteína y timing del entreno", () => {
  const at = (d: string, t: string) => core.zonedTime(d, t, "Europe/Madrid");
  it("hora habitual, plan del día de entreno, aviso de proteína y aviso tras entrenar", async () => {
    const [p] = await db.select().from(persons).where(eq(persons.userId, "gym"));
    const pid = p!.id;
    const D = "2027-03-01"; // Monday
    for (const d of ["2027-02-15", "2027-02-22"]) await db.insert(exerciseLogs).values({ personId: pid, date: d, startedAt: at(d, d.endsWith("15") ? "18:20" : "18:40"), name: "Torso", durationMin: 70, kcal: 300 });
    expect(await core.usualTrainingTime(db, pid, "Europe/Madrid", D, 1)).toMatchObject({ time: "18:30", durationMin: 70, samples: 2 });
    // Not a planned day and nothing logged: rest day, no card.
    expect(await core.trainingDayPlan(db, pid, at(D, "16:00"))).toBeNull();
    await core.saveSportProfile(db, pid, true, { trainingDays: [1] });

    const [f] = await db.insert(foods).values({ source: "custom", name: "Queso batido", kcal: 46, protein: 8, carbs: 3.5, fat: 0.2, nutrients: { energy_kcal: 46, protein: 8 } }).returning();
    await core.addEntries(db, { personId: pid, userId: "gym", date: D, mealSlot: "lunch", origin: "manual", items: [{ foodId: f!.id, grams: 300 }] });
    const plan = await core.trainingDayPlan(db, pid, at(D, "16:00"));
    expect(plan).toMatchObject({ phase: "pre", done: false, known: true, proteinDoseG: 29 });
    expect(plan!.timing).toMatchObject({ start: "18:30", preFrom: "15:30", postUntil: "21:40" });
    expect(plan!.ideas[0]).toMatchObject({ name: "Queso batido", grams: 300, protein: 24 });

    // 20:00: protein missing → nudge with the person's own ideas; not when disabled.
    await core.remindersTick(db, at(D, "20:02"));
    const [n] = await db.select().from(notifications).where(eq(notifications.type, "protein"));
    expect(n?.title).toMatch(/Te faltan \d+ g de proteína/);
    expect(n?.body).toContain("Queso batido (24 g)");
    await db.insert(notificationPrefs).values({ userId: "gym", type: "protein", enabled: false, config: {} });
    await core.remindersTick(db, at(D, "20:02"));
    expect(await db.select().from(notifications).where(eq(notifications.type, "protein"))).toHaveLength(1);

    // Start time priority: openGym median < fixed time of the weekday < «solo para hoy» < logged.
    expect(plan!.source).toBe("usual");
    await core.saveSportProfile(db, pid, true, { trainingTimes: { "1": "19:30", "3": "07:00" } });
    let p2 = await core.trainingDayPlan(db, pid, at(D, "16:00"));
    expect(p2).toMatchObject({ source: "fixed", known: true });
    expect(p2!.timing.start).toBe("19:30");
    expect((await core.trainingDayMeals(db, pid, D, at(D, "16:00"))).session).toMatchObject({ source: "fixed", start: 19 * 60 + 30 });
    await core.saveSportProfile(db, pid, true, { timeToday: { date: D, time: "20:15" } });
    p2 = await core.trainingDayPlan(db, pid, at(D, "16:00"));
    expect(p2).toMatchObject({ source: "today" });
    expect(p2!.timing.start).toBe("20:15");
    expect((await core.caffeineDay(db, pid, D, at(D, "16:00"))).trainingSource).toBe("today");
    // «Solo para hoy» expires the next day: back to the fixed time.
    expect((await core.trainingDayPlan(db, pid, at("2027-03-08", "16:00")))!.timing.start).toBe("19:30");
    await core.saveSportProfile(db, pid, true, { timeToday: undefined, trainingTimes: undefined });

    // Workout logged today: real times, already in the post window.
    await db.insert(exerciseLogs).values({ personId: pid, date: D, startedAt: at(D, "17:00"), name: "Torso", durationMin: 60, kcal: 300 });
    const done = await core.trainingDayPlan(db, pid, at(D, "18:30"));
    expect(done).toMatchObject({ phase: "post", done: true, source: "logged" });
    expect(done!.timing).toMatchObject({ start: "17:00", end: "18:00", postUntil: "20:00" });
    expect(await core.notifyPostWorkout(db, pid, [{ startedAt: at(D, "17:00"), durationMin: 60 }], 72, at(D, "18:30"))).toBe(true);
    expect(await core.notifyPostWorkout(db, pid, [{ startedAt: at("2027-02-22", "18:40"), durationMin: 70 }], 72, at(D, "18:30"))).toBe(false);
    const [pw] = await db.select().from(notifications).where(eq(notifications.type, "post_workout"));
    expect(pw?.body).toContain("22–29 g");
  });
});

describe("informe semanal", () => {
  it("el domingo cubre la semana en curso, guarda «un cambio», avisa y prepara el webhook", async () => {
    const { createProvider, MockProvider } = await import("@nutria/ai");
    const [p] = await db.select().from(persons).where(eq(persons.userId, "gym"));
    const pid = p!.id;
    expect(core.reportWeekStart("2027-03-07")).toBe("2027-03-01"); // Sunday → this week
    expect(core.reportWeekStart("2027-03-08")).toBe("2027-03-01"); // Monday → last week
    await db.insert(webhooks).values({ userId: "gym", url: "https://example.com/hook", secretEnc: encrypt("s"), events: ["report.weekly"] });
    // The only logged day has 138 kcal: well under half the target, so it does not count as eating little.
    const partial = await core.weeklyReportExtras(db, pid, "2027-03-01");
    expect(partial.adherencia).toMatchObject({ diasRegistrados: 1, diasValidos: 0, diasIncompletos: ["2027-03-01"], proteinaPorComida: null });
    // Marked as complete by the person: it counts again.
    await db.update(dailySummaries).set({ complete: true }).where(and(eq(dailySummaries.personId, pid), eq(dailySummaries.date, "2027-03-01")));
    const x = await core.weeklyReportExtras(db, pid, "2027-03-01");
    expect(x.adherencia).toMatchObject({ diasRegistrados: 1, diasValidos: 1, diasIncompletos: [], diasConProteina: 0 });
    expect(x.adherencia.objetivoPorDia).toHaveLength(7);
    expect(x.adherencia.proteinaPorComida).toMatchObject({ tomaIdealG: 29, comidasPrincipales: 1, llegan: 0 });
    expect(x.entrenos).toMatchObject({ sesiones: 1, minutos: 60 });

    const now = core.zonedTime("2027-03-07", "20:00", "Europe/Madrid");
    const r = await core.buildWeeklyReport(db, pid, createProvider("mock"), now);
    expect(r?.oneChange).toContain("yogur");
    expect(r?.webhooks).toHaveLength(1);
    expect(r?.webhooks[0]).toMatchObject({ event: "report.weekly", payload: { weekStart: "2027-03-01", weekEnd: "2027-03-07" } });
    await core.buildWeeklyReport(db, pid, createProvider("mock"), now); // same week: replaced
    const rows = await db.select().from(insights).where(and(eq(insights.personId, pid), eq(insights.kind, "weekly")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ periodStart: "2027-03-01", periodEnd: "2027-03-07" });
    expect((rows[0]!.data as { cambio: string; adherencia: unknown }).cambio).toContain("yogur");
    expect((rows[0]!.data as { adherencia: unknown }).adherencia).toBeTruthy();
    const [n] = await db.select().from(notifications).where(eq(notifications.type, "weekly_report"));
    expect(n?.body).toMatch(/^Un cambio para esta semana: /);
    // A week without diary days gives no report, without calling the AI (a provider with no answers would throw).
    expect(await core.buildWeeklyReport(db, pid, new MockProvider({}), core.zonedTime("2028-01-02", "20:00", "Europe/Madrid"))).toBeNull();
  });
});

describe("registro rápido", () => {
  it("plantillas en un toque, sugerencia de comidas repetidas, «como ayer» y batido", async () => {
    const [p] = await db.select().from(persons).where(eq(persons.userId, "gym"));
    const pid = p!.id;
    const mk = async (name: string, protein: number) => (await db.insert(foods).values({ source: "custom", name, kcal: 100, protein, carbs: 10, fat: 2, nutrients: { energy_kcal: 100, protein } }).returning())[0]!.id;
    const [avena, leche] = [await mk("Avena", 13), await mk("Leche", 3)];
    const days = ["2027-04-05", "2027-04-07", "2027-04-08"];
    for (const d of days) await core.addEntries(db, { personId: pid, userId: "gym", date: d, mealSlot: "breakfast", origin: "manual", items: [{ foodId: avena, grams: 60 }, { foodId: leche, grams: 250 }] });
    await core.addEntries(db, { personId: pid, userId: "gym", date: "2027-04-08", mealSlot: "lunch", origin: "manual", items: [{ foodId: avena, grams: 60 }] });

    const sug = await core.templateSuggestions(db, pid, "2027-04-09");
    expect(sug).toHaveLength(1);
    expect(sug[0]).toMatchObject({ slot: "breakfast", date: "2027-04-08", times: 3, names: ["Avena", "Leche"] });
    const t = await core.saveMealAsTemplate(db, pid, sug[0]!.date, "breakfast", "Desayuno de avena");
    expect(t.items).toHaveLength(2);
    expect(await core.templateSuggestions(db, pid, "2027-04-09")).toHaveLength(0); // already a template

    // «Lo de siempre» at breakfast time logs the template and counts the use.
    const at = (t: string) => core.zonedTime("2027-04-09", t, "Europe/Madrid");
    const usual = await core.quickLog(db, { personId: pid, userId: "gym", kind: "usual" }, at("08:10"));
    expect(usual).toEqual({ ok: true, message: "Registrado en desayuno: Desayuno de avena" });
    expect(await db.select().from(diaryEntries).where(and(eq(diaryEntries.personId, pid), eq(diaryEntries.date, "2027-04-09"), eq(diaryEntries.mealSlot, "breakfast")))).toHaveLength(2);
    expect((await core.listTemplates(db, pid))[0]!.useCount).toBe(1);
    expect((await core.quickLog(db, { personId: pid, userId: "gym", kind: "usual" }, at("14:40"))).message).toMatch(/Aún no tienes una plantilla para comida/);

    // «Como ayer»: copies the same meal once.
    expect(await core.quickLog(db, { personId: pid, userId: "gym", kind: "yesterday", slot: "lunch" }, at("14:40"))).toEqual({ ok: true, message: "Copiado de ayer: 1 alimento en comida" });
    expect((await core.quickLog(db, { personId: pid, userId: "gym", kind: "yesterday", slot: "lunch" }, at("14:40"))).ok).toBe(false);
    expect((await core.quickLog(db, { personId: pid, userId: "gym", kind: "yesterday", slot: "dinner" }, at("21:00"))).message).toBe("Ayer no registraste cena");

    // Shake: needs whey in the supplements (or a «Batido» template), then logs it once.
    expect((await core.quickLog(db, { personId: pid, userId: "gym", kind: "shake" }, at("19:00"))).ok).toBe(false);
    await core.addSupplementPlan(db, pid, "gym", { code: "whey", dose: 30, doseUnit: "g", gramsPerDose: 30, times: [], daysOfWeek: [1, 2, 3, 4, 5, 6, 7] });
    expect((await core.quickLog(db, { personId: pid, userId: "gym", kind: "shake" }, at("19:00"))).message).toMatch(/^Batido registrado: /);
    expect((await core.quickLog(db, { personId: pid, userId: "gym", kind: "shake" }, at("19:05"))).message).toBe("El batido de hoy ya estaba registrado");
  });
});

describe("datos del móvil", () => {
  it("pasos, sueño, pulso, peso y ejercicio en el formato de Health Connect, sin duplicar al reenviar", async () => {
    const { stepLogs, sleepLogs, heartRateDaily } = await import("@nutria/db");
    const [p] = await db.select().from(persons).where(eq(persons.userId, "gym"));
    const pid = p!.id;
    const payload = {
      timestamp: "2027-05-10T21:00:00Z",
      steps: [
        { count: 4200, start_time: "2027-05-10T06:00:00Z", end_time: "2027-05-10T10:00:00Z" },
        { count: 3800, start_time: "2027-05-10T10:00:00Z", end_time: "2027-05-10T18:00:00Z" },
        { count: 900, start_time: "2027-05-09T22:30:00Z", end_time: "2027-05-09T23:00:00Z" }, // 00:30 in Madrid → day 10
      ],
      sleep: [{ session_end_time: "2027-05-10T05:30:00Z", duration_seconds: 27000 }],
      heart_rate: [
        { bpm: 58, time: "2027-05-10T04:00:00Z" },
        { bpm: 142, time: "2027-05-10T17:00:00Z" },
        { bpm: 70, time: "2027-05-10T12:00:00Z" },
      ],
      resting_heart_rate: [{ bpm: 54, time: "2027-05-10T05:00:00Z" }],
      weight: [{ kilograms: 73.4, time: "2027-05-10T06:10:00Z" }],
      exercise: [{ type: "running", start_time: "2027-05-10T17:00:00Z", end_time: "2027-05-10T17:40:00Z" }],
      unknown_block: [{ a: 1 }],
    };
    const data = core.parseHealthPayload(payload, "Europe/Madrid");
    expect(data.steps).toEqual([{ date: "2027-05-10", steps: 8900 }]);
    expect(data.sleep[0]).toMatchObject({ date: "2027-05-10", hours: 7.5 });
    expect(data.heart[0]).toMatchObject({ date: "2027-05-10", min: 58, max: 142, avg: 90, resting: 54, samples: 3 });
    expect(data.exercise[0]).toMatchObject({ name: "Correr", minutes: 40 });

    expect(await core.importHealthData(db, pid, data)).toEqual({ steps: 1, sleep: 1, heartDays: 1, weights: 1, exercise: 1 });
    // Same batch again, then a partial one: nothing is duplicated and the counts never go down.
    expect((await core.importHealthData(db, pid, data)).weights).toBe(0);
    await core.importHealthData(db, pid, core.parseHealthPayload({ steps: [{ count: 5000, start_time: "2027-05-10T06:00:00Z" }], heart_rate: [{ bpm: 50, time: "2027-05-10T03:00:00Z" }] }, "Europe/Madrid"));
    const [st] = await db.select().from(stepLogs).where(and(eq(stepLogs.personId, pid), eq(stepLogs.date, "2027-05-10")));
    expect(st).toMatchObject({ steps: 8900 });
    expect(st!.kcal).toBeGreaterThan(200);
    const [sl] = await db.select().from(sleepLogs).where(and(eq(sleepLogs.personId, pid), eq(sleepLogs.date, "2027-05-10")));
    expect(sl!.hours).toBe(7.5);
    const [h] = await db.select().from(heartRateDaily).where(and(eq(heartRateDaily.personId, pid), eq(heartRateDaily.date, "2027-05-10")));
    expect(h).toMatchObject({ minBpm: 50, maxBpm: 142, avgBpm: 90, restingBpm: 54, samples: 3 });
    expect(await db.select().from(weightLogs).where(and(eq(weightLogs.personId, pid), eq(weightLogs.source, "health")))).toHaveLength(1);
    const ex = await db.select().from(exerciseLogs).where(and(eq(exerciseLogs.personId, pid), eq(exerciseLogs.source, "health")));
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ name: "Correr", durationMin: 40 });
    // Simple shape, and a gym day already covered by openGym is not counted twice.
    await db.insert(exerciseLogs).values({ personId: pid, date: "2027-05-11", name: "Pierna", durationMin: 60, kcal: 300, source: "opengym", externalId: "og-x" });
    const r = await core.importHealthData(db, pid, core.parseHealthPayload({ steps: 3000, date: "2027-05-11", exercise: [{ activity: "strength_training", start: "2027-05-11T17:00:00Z", minutes: 55 }] }, "Europe/Madrid"));
    expect(r).toMatchObject({ steps: 1, exercise: 0 });
    expect(core.parseHealthPayload(null, "Europe/Madrid")).toEqual({ steps: [], sleep: [], heart: [], weights: [], exercise: [] });
  });
});

describe("disco", () => {
  it("niveles y aviso solo al subir de nivel", () => {
    expect(core.diskLevel(50)).toBe("ok");
    expect(core.diskLevel(85)).toBe("warn");
    expect(core.diskLevel(95.2)).toBe("critical");
    expect(core.diskShouldNotify("warn", "ok")).toBe(true);
    expect(core.diskShouldNotify("warn", "warn")).toBe(false);
    expect(core.diskShouldNotify("critical", "warn")).toBe(true);
    expect(core.diskShouldNotify("ok", "critical")).toBe(false);
  });
  it("escribe disk.json con el uso real y el tamaño de la BD", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nutria-disk-"));
    const s = await core.checkDisk(db, dir);
    expect(s.totalBytes).toBeGreaterThan(0);
    expect(s.usedPct).toBeGreaterThanOrEqual(0);
    expect(s.usedPct).toBeLessThanOrEqual(100);
    expect(await core.readDiskStatus(dir)).toMatchObject({ level: s.level, usedPct: s.usedPct });
  });
});

describe("curva de cafeína", () => {
  const at = (d: string, t: string) => core.zonedTime(d, t, "Europe/Madrid");
  it("tomas con su hora, entreno habitual y hora de dormir pasada la medianoche", async () => {
    const [p] = await db.select().from(persons).where(eq(persons.userId, "gym"));
    const pid = p!.id;
    const D = "2027-03-08"; // Monday (training day since the timing test)
    await db.insert(sleepLogs).values([
      { personId: pid, date: "2027-03-05", bedtime: at("2027-03-04", "23:50"), wakeTime: at("2027-03-05", "07:30"), hours: 7.6 },
      { personId: pid, date: "2027-03-06", bedtime: at("2027-03-06", "00:40"), wakeTime: at("2027-03-06", "08:00"), hours: 7.3 },
    ]);
    const coffee = { energy_kcal: 3, caffeine: 150 };
    await core.addEntries(db, { personId: pid, userId: "gym", date: D, mealSlot: "breakfast", origin: "manual", items: [{ name: "Café", grams: 150, absolute: coffee, eatenAt: at(D, "08:15") }] });
    await core.addEntries(db, { personId: pid, userId: "gym", date: "2027-03-07", mealSlot: "dinner", origin: "manual", items: [{ name: "Café tarde", grams: 60, absolute: { caffeine: 60 }, eatenAt: at("2027-03-07", "22:00") }, { name: "Café mañana", grams: 60, absolute: { caffeine: 60 }, eatenAt: at("2027-03-07", "09:00") }] });
    const day = await core.caffeineDay(db, pid, D, at("2027-03-08", "10:00"));
    expect(day.doses.map((d) => [d.name, d.at, d.mg])).toEqual([["Café tarde", -120, 60], ["Café", 495, 150]]);
    expect(day).toMatchObject({ trainingSource: "usual", bedtime: 1455, bedtimeSource: "sleep", halfLifeH: 5, halfLifeSource: "default" });
    expect(day.trainingStart).toBeGreaterThan(17 * 60);
    await db.update(persons).set({ settings: { caffeine: { bedtime: "23:00", halfLifeH: 8 } } }).where(eq(persons.id, pid));
    expect(await core.caffeineDay(db, pid, D, at("2027-03-08", "10:00"))).toMatchObject({ bedtime: 1380, bedtimeSource: "manual", halfLifeH: 8 });
  });
});

describe("días a medias", () => {
  it("el filtro SQL coincide con la regla: fuera los marcados incompletos y los de menos de la mitad del objetivo", async () => {
    const [p] = await db.select().from(persons).where(eq(persons.userId, "gym"));
    const pid = p!.id;
    const [t] = await db.select({ kcal: targetSets.kcal }).from(targetSets).where(and(eq(targetSets.personId, pid), eq(targetSets.isDefault, true)));
    expect(t?.kcal).toBeGreaterThan(1000);
    await db.insert(dailySummaries).values([
      { personId: pid, date: "2027-09-01", kcal: t!.kcal, entries: 8 },
      { personId: pid, date: "2027-09-02", kcal: 400, entries: 3 },
      { personId: pid, date: "2027-09-03", kcal: t!.kcal, entries: 9, incomplete: true },
      { personId: pid, date: "2027-09-04", kcal: 400, entries: 2, complete: true },
      { personId: pid, date: "2027-09-05", kcal: 0, entries: 0 },
    ]);
    const rows = await db
      .select({ date: dailySummaries.date })
      .from(dailySummaries)
      .where(and(eq(dailySummaries.personId, pid), gte(dailySummaries.date, "2027-09-01"), lte(dailySummaries.date, "2027-09-05"), core.trustedDaySql()))
      .orderBy(dailySummaries.date);
    expect(rows.map((r) => r.date)).toEqual(["2027-09-01", "2027-09-04"]);
  });
});

describe("hora al registrar", () => {
  it("hoy sin hora → ahora; otro día, plan o con hora propia → no se toca", async () => {
    const [p] = await db.select().from(persons).where(eq(persons.userId, "gym"));
    const pid = p!.id;
    const now = core.zonedTime("2027-10-04", "13:47", p!.timezone);
    const add = (date: string, origin: "manual" | "plan", eatenAt?: Date) =>
      core.addEntries(db, { personId: pid, userId: "gym", date, mealSlot: "lunch", origin, items: [{ name: "Arroz", grams: 100, absolute: { energy_kcal: 130 }, eatenAt }] }, now);
    expect((await add("2027-10-04", "manual"))[0]!.eatenAt).toEqual(now);
    expect((await add("2027-10-03", "manual"))[0]!.eatenAt).toBeNull();
    expect((await add("2027-10-04", "plan"))[0]!.eatenAt).toBeNull();
    const mine = core.zonedTime("2027-10-04", "09:10", p!.timezone);
    expect((await add("2027-10-04", "manual", mine))[0]!.eatenAt).toEqual(mine);
  });
});

describe("comida y entreno", () => {
  it("día: sesión registrada, comidas agrupadas con su hora; historial con horas reales", async () => {
    const [p] = await db.select().from(persons).where(eq(persons.userId, "gym"));
    const pid = p!.id;
    const tz = p!.timezone;
    const D = "2027-11-08";
    const at = (t: string) => core.zonedTime(D, t, tz);
    const add = (slot: string, name: string, carbs: number, protein: number, eatenAt?: Date) =>
      core.addEntries(db, { personId: pid, userId: "gym", date: D, mealSlot: slot, origin: "manual", items: [{ name, grams: 100, absolute: { energy_kcal: carbs * 4 + protein * 4, carbs, protein }, eatenAt }] }, at("23:00"));
    await add("lunch", "Arroz", 70, 8, at("15:40"));
    await add("lunch", "Pollo", 0, 30, at("15:50"));
    await add("dinner", "Batido", 10, 30, at("19:45"));
    // Logged the next day without a time: the meal's usual time stands in (approximate).
    await core.addEntries(db, { personId: pid, userId: "gym", date: D, mealSlot: "breakfast", origin: "manual", items: [{ name: "Avena", grams: 80, absolute: { energy_kcal: 300, carbs: 50, protein: 10 } }] }, core.zonedTime("2027-11-09", "09:00", tz));
    await db.insert(exerciseLogs).values({ personId: pid, date: D, startedAt: at("17:45"), name: "Pierna", durationMin: 70, kcal: 400, details: { exercises: [{ id: "sq", name: "Sentadilla", sets: [{ kg: 100, reps: 5 }] }] } });

    const day = await core.trainingDayMeals(db, pid, D, at("23:00"));
    expect(day.session).toMatchObject({ start: 17 * 60 + 45, end: 18 * 60 + 55, source: "logged", name: "Pierna" });
    const lunch = day.meals.find((m) => m.slot === "lunch")!;
    expect(lunch).toMatchObject({ at: 15 * 60 + 40, carbs: 70, protein: 38, approx: false, names: ["Arroz", "Pollo"] });
    expect(day.meals.find((m) => m.slot === "breakfast")?.approx).toBe(true);

    const h = await core.trainingMealHistory(db, pid, 12, at("23:00"));
    expect(h.sessions.some((s) => s.exercises[0]?.id === "sq")).toBe(true);
    expect(h.meals.every((m) => !m.approx)).toBe(true);
    expect(h.meals.some((m) => m.carbs === 70 && m.protein === 38)).toBe(true);
  });
});

describe("mejor hora para entrenar", () => {
  it("usa el horario del gimnasio, el peso y el sueño; sin horario no hay plan", async () => {
    const [p] = await db.select().from(persons).where(eq(persons.userId, "gym"));
    const pid = p!.id;
    const now = core.zonedTime("2027-11-10", "10:00", p!.timezone);
    expect((await core.trainingTimeContext(db, pid, now)).plan).toBeNull();
    await core.saveSportProfile(db, pid, true, { gymHours: [{ from: "17:00", to: "22:00" }, { from: "09:30", to: "13:30" }] });
    const c = await core.trainingTimeContext(db, pid, now);
    expect(c.gymHours[0]).toEqual({ from: "09:30", to: "13:30" }); // sorted
    expect(c.plan?.perWindow).toHaveLength(2);
    expect(c.plan!.best!.start).toBeLessThan(13 * 60 + 30);
    expect(c.plan!.perWindow[1]!.caffeine.fits).toBe(false);
  });
});

describe("masa magra", () => {
  it("entrenos frente a plan, fuerza y peso; alerta tras semanas sin entrenar", async () => {
    const [p] = await db.select().from(persons).where(eq(persons.userId, "gym"));
    const pid = p!.id;
    const tz = p!.timezone;
    const s = await core.leanMassStatus(db, pid, core.zonedTime("2027-11-10", "12:00", tz));
    expect(s).not.toBeNull();
    expect(s!.plannedPerWeek).toBeGreaterThan(0);
    expect(typeof s!.sessionsLast28).toBe("number");
    // A month later with nothing logged: alert.
    const later = await core.leanMassStatus(db, pid, core.zonedTime("2028-01-20", "12:00", tz));
    expect(later!.check.level).toBe("alert");
  });
});
