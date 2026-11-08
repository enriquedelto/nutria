import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notifications, persons, user, weightLogs, type Database } from "@nutria/db";
import { createTestDb } from "@nutria/db/testing";
import { JOBS } from "@nutria/core";
import { handlers } from "../src/handlers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Database;
const ctx = () => ({ db, boss: { send: async () => "id" } as never, signal: new AbortController().signal });

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Database;
  await db.insert(user).values({ id: "u", name: "U", email: "u@x.es" });
  const [p] = await db.insert(persons).values({ userId: "u", displayName: "U", sex: "female", birthDate: "1992-03-03", heightCm: 165 }).returning();
  await db.insert(weightLogs).values({ personId: p!.id, date: "2026-11-01", kg: 62 });
  await db.insert(notifications).values({ userId: "u", type: "water", title: "viejo", createdAt: new Date("2025-01-01") });
});
afterAll(async () => t?.close());

describe("handlers del worker", () => {
  it("limpieza borra notificaciones antiguas", async () => {
    const r = (await handlers[JOBS.cleanup]({}, ctx())) as { notifications: number };
    expect(r.notifications).toBe(1);
  });
  it("TDEE semanal para personas con pesajes", async () => {
    const r = (await handlers[JOBS.tdeeWeekly]({}, ctx())) as { persons: number };
    expect(r.persons).toBe(1);
  });
  it("informe semanal se omite sin IA", async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.AI_BACKEND;
    const r = (await handlers[JOBS.weeklyReport]({}, ctx())) as { skipped?: string };
    expect(r.skipped).toBeDefined();
  });
});
