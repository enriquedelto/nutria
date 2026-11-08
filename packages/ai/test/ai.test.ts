import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { aiEstimates, aiMessages, aiUsage, diaryEntries, eq, foods, groups, persons, portionMemory, searchFoods, user, type Database } from "@nutria/db";
import { createTestDb } from "@nutria/db/testing";
import {
  ALL_TOOLS,
  AiError,
  assertQuota,
  coachChat,
  estimateMeal,
  executeTool,
  extractJson,
  learnPortion,
  MealEstimate,
  MealPlanDraft,
  MockProvider,
  defaultMockHandlers,
  portionKey,
  toolsFor,
  whatIf,
  type ToolContext,
} from "../src";

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Database;
let personId: string;
let groupId: string;
const userId = "u1";
const ALL = new Set(["diary", "body", "health", "cycle", "labs", "medication", "photos", "ai"]);

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Database;
  await db.insert(user).values({ id: userId, name: "Enrique", email: "e@example.com" });
  const [g] = await db.insert(groups).values({ name: "Casa" }).returning();
  groupId = g!.id;
  const [p] = await db.insert(persons).values({ groupId, userId, displayName: "Enrique", sex: "male", birthDate: "1990-05-01", heightCm: 178, allergens: ["cacahuete"] }).returning();
  personId = p!.id;
  await db.insert(foods).values([
    { source: "ciqual", sourceId: "25601", name: "Omelette, potato", nameEs: "Tortilla de patatas", kcal: 185, protein: 6.8, carbs: 12, fat: 12, nutrients: { energy_kcal: 185, protein: 6.8, carbs: 12, fat: 12, iron: 1 } },
    { source: "ciqual", sourceId: "1", name: "Lentils, boiled", nameEs: "Lentejas cocidas", kcal: 116, protein: 9, carbs: 16, fat: 0.4, nutrients: { energy_kcal: 116, iron: 3.3 } },
  ]);
});
afterAll(async () => t?.close());

const ctx = (scopes = ALL): ToolContext => ({ db, userId, personId, groupId, timezone: "Europe/Madrid", scopes, proposals: [] });

describe("utilidades", () => {
  it("extrae JSON de texto con prosa o bloques", () => {
    expect(extractJson('Aquí va:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('blah {"b":[1,2]} fin')).toEqual({ b: [1, 2] });
    expect(() => extractJson("nada")).toThrow(AiError);
  });
  it("los esquemas de salida no pierden mapas al forzar additionalProperties:false", () => {
    for (const s of [MealEstimate, MealPlanDraft]) {
      const json = JSON.stringify(betaZodOutputFormat(s).schema);
      expect(json).not.toContain('"additionalProperties":{');
    }
  });
  it("clave de porción normalizada", () => {
    expect(portionKey("Mi plato de Pásta!")).toBe("mi plato de pasta");
  });
  it("what if", () => {
    const r = whatIf({ energy_kcal: 1500, protein: 80, carbs: 150, fat: 50 }, [{ nutrients: { energy_kcal: 700, protein: 30, carbs: 60, fat: 30 } }], { kcal: 2000, protein: 120, carbs: 230, fat: 70 });
    expect(r.remaining.kcal).toBe(-200);
    expect(r.overKcal).toBe(true);
  });
});

describe("búsqueda", () => {
  it("ignora acentos y mayúsculas", async () => {
    const r = await searchFoods(db, "LENTEJAS", { groupId });
    expect(r[0]?.nameEs).toBe("Lentejas cocidas");
    expect((await searchFoods(db, "tortilla patatas", { groupId }))[0]?.nameEs).toBe("Tortilla de patatas");
  });
});

describe("herramientas", () => {
  it("niega datos sin permiso y valida la entrada", async () => {
    const labs = ALL_TOOLS.find((x) => x.name === "get_labs")!;
    const r = await executeTool(labs, {}, ctx(new Set(["diary"])));
    expect(r.ok).toBe(false);
    expect(r.text).toContain("Sin permiso");
    const search = ALL_TOOLS.find((x) => x.name === "search_foods")!;
    expect((await executeTool(search, { query: "" }, ctx())).ok).toBe(false);
  });
  it("solo ofrece herramientas permitidas", () => {
    const names = toolsFor(new Set(["diary"])).map((x) => x.name);
    expect(names).toContain("get_diary");
    expect(names).not.toContain("get_cycle");
    expect(names).not.toContain("get_medications");
  });
  it("oráculo de nutrientes por 100 kcal", async () => {
    const tool = ALL_TOOLS.find((x) => x.name === "nutrient_ranking")!;
    const r = await executeTool(tool, { nutrient: "iron", per: "100kcal" }, ctx());
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.text)[0].name).toBe("Lentejas cocidas");
  });
  it("get_diary agrupa por día", async () => {
    await db.insert(diaryEntries).values({ personId, date: "2026-11-01", mealSlot: "lunch", name: "Lentejas", grams: 300, kcal: 348, protein: 27, carbs: 48, fat: 1.2, nutrients: { energy_kcal: 348, iron: 9.9 } });
    const tool = ALL_TOOLS.find((x) => x.name === "get_diary")!;
    const r = await executeTool(tool, { from: "2026-11-01", to: "2026-11-02", includeMicros: true }, ctx());
    const days = JSON.parse(r.text);
    expect(days[0].totals.kcal).toBe(348);
    expect(days[0].totals.micros.iron).toBeCloseTo(9.9);
  });
});

describe("registro por IA (simulado)", () => {
  it("empareja con el catálogo, guarda la estimación y el uso", async () => {
    const provider = new MockProvider(defaultMockHandlers());
    const r = await estimateMeal({ db, userId, personId, scopes: ALL, provider }, { text: "tortilla y pan", mode: "text", mealSlot: "lunch" });
    expect(r.items).toHaveLength(2);
    expect(r.items[0]!.match?.name).toBe("Tortilla de patatas");
    expect(r.items[0]!.macros.kcal).toBeCloseTo(277.5, 0); // 150 g × 185 kcal/100 g
    expect(r.items[1]!.match).toBeNull(); // pan no está en el catálogo → estimación IA
    expect(r.items[1]!.macros.kcal).toBeCloseTo(106, 0);
    const [e] = await db.select().from(aiEstimates).where(eq(aiEstimates.id, r.estimateId));
    expect(e?.status).toBe("pending");
    const usage = await db.select().from(aiUsage).where(eq(aiUsage.userId, userId));
    expect(usage.some((u) => u.feature === "meal_text")).toBe(true);
  });
});

describe("coach (simulado)", () => {
  it("usa herramientas, crea propuestas y guarda la conversación", async () => {
    const provider = new MockProvider({}, () => [
      { tool: "get_diary", input: { from: "2026-11-01", to: "2026-11-01" } },
      { tool: "propose_diary_entries", input: { mealSlot: "dinner", items: [{ name: "Yogur", grams: 125 }] } },
      { tool: "get_cycle", input: {} }, // no disponible con estos permisos → no se ejecuta
    ]);
    let streamed = "";
    const r = await coachChat(
      { db, userId, personId, scopes: new Set(["diary", "ai"]), provider, groupId, timezone: "Europe/Madrid" },
      { message: "¿Qué tal voy?", onText: (d) => (streamed += d) },
    );
    expect(r.toolCalls.map((x) => x.name)).toEqual(["get_diary", "propose_diary_entries"]);
    expect(r.proposals[0]?.kind).toBe("diary_entries");
    expect(streamed).toContain("¿Qué tal voy?");
    const msgs = await db.select().from(aiMessages).where(eq(aiMessages.conversationId, r.conversationId));
    expect(msgs).toHaveLength(2);
    const second = await coachChat({ db, userId, personId, scopes: ALL, provider: new MockProvider(), groupId, timezone: "Europe/Madrid" }, { conversationId: r.conversationId, message: "Gracias" });
    expect(second.conversationId).toBe(r.conversationId);
  });
});

describe("cuota y porciones", () => {
  it("bloquea al superar el límite diario", async () => {
    await expect(assertQuota(db, userId, "api", { dailyRequests: 1, monthlyUsd: 100 })).rejects.toMatchObject({ code: "quota" });
    await expect(assertQuota(db, userId, "mock", { dailyRequests: 0, monthlyUsd: 0 })).resolves.toBeUndefined();
  });
  it("aprende porciones con media móvil", async () => {
    await learnPortion(db, personId, "Mi plato de pasta", 100);
    await learnPortion(db, personId, "mi plato de PASTA", 120);
    const [m] = await db.select().from(portionMemory).where(eq(portionMemory.personId, personId));
    expect(m?.grams).toBe(110);
    expect(m?.samples).toBe(2);
  });
});
