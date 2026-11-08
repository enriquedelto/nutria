import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "../src/testing";
import { foods, groups, persons, user } from "../src/schema";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t.close());

describe("migraciones", () => {
  it("crea todas las tablas", async () => {
    const r = await t.db.execute(sql`select count(*)::int as n from information_schema.tables where table_schema='public'`);
    expect((r.rows[0] as { n: number }).n).toBeGreaterThan(70);
  });

  it("inserta persona y busca alimento con trigram + unaccent", async () => {
    await t.db.insert(user).values({ id: "u1", name: "Ana", email: "ana@example.com" });
    const [g] = await t.db.insert(groups).values({ name: "Casa" }).returning();
    const [p] = await t.db.insert(persons).values({ displayName: "Ana", userId: "u1", groupId: g!.id }).returning();
    expect(p!.id).toMatch(/^[0-9a-f-]{36}$/);
    await t.db.insert(foods).values({ source: "custom", name: "Plátano de Canarias", kcal: 94 });
    const r = await t.db.execute(
      sql`select name from foods where f_unaccent(lower(name)) % f_unaccent(lower(${"platano"})) or f_unaccent(lower(name)) like ${"%platano%"}`,
    );
    expect(r.rows.length).toBe(1);
  });
});
