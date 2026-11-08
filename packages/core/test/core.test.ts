import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aiEstimates,
  dailySummaries,
  diaryEntries,
  eq,
  exerciseLogs,
  foods,
  imports,
  insights,
  mealSlots,
  medicationDoses,
  medications,
  notifications,
  personAccess,
  personAchievements,
  persons,
  symptomLogs,
  targetSets,
  user,
  webhooks,
  weightLogs,
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

describe("objetivos", () => {
  it("calcula objetivos y respeta el modo fijo", async () => {
    const t1 = await core.recomputeTargets(db, personId);
    expect(t1!.kcal).toBeGreaterThan(1800);
    expect(t1!.kcal).toBeLessThan(2800);
    expect(t1!.micros.iron?.min).toBeGreaterThan(0);
    await db.update(targetSets).set({ mode: "fixed", kcal: 1999 }).where(eq(targetSets.id, t1!.id));
    const t2 = await core.recomputeTargets(db, personId);
    expect(t2!.kcal).toBe(1999);
    await db.update(targetSets).set({ mode: "dynamic" }).where(eq(targetSets.id, t1!.id));
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
  it("sincroniza entrenos y pesajes sin duplicar", async () => {
    const [p] = await db.select().from(persons).where(eq(persons.id, personId));
    const { integrationAccounts } = await import("@nutria/db");
    const [acc] = await db.insert(integrationAccounts).values({ userId: uid, personId: p!.id, provider: "opengym", baseUrl: "http://og", credentialsEnc: encrypt("tok") }).returning();
    let rev = 3;
    const fake = (async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe("http://og/api/data");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      return new Response(JSON.stringify({ rev, state: { unit: "kg", workouts: [{ id: "w1", d: "2026-11-02", start: 0, end: 3_600_000, name: "Torso", vol: 8000, entries: [{ id: "bench", sets: [{ w: 80, r: 8 }] }] }], bodyweight: [{ d: "2026-11-02", w: 84.2, t: 1 }] } }));
    }) as unknown as typeof fetch;
    const r1 = await core.syncOpenGym(db, acc!.id, fake);
    expect(r1).toMatchObject({ exercises: 1, weights: 1 });
    rev = 4;
    await core.syncOpenGym(db, acc!.id, fake);
    expect(await db.select().from(exerciseLogs).where(eq(exerciseLogs.personId, personId))).toHaveLength(1);
    expect((await db.select().from(weightLogs).where(eq(weightLogs.source, "opengym"))).length).toBe(1);
    const [s] = await db.select().from(dailySummaries).where(eq(dailySummaries.date, "2026-11-02"));
    expect(s?.exerciseKcal).toBeGreaterThan(100);
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
