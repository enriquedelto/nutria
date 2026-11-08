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

describe("seed", () => {
  it("carga catálogos de referencia de forma idempotente", async () => {
    const { seedReference } = await import("../src/seed/run");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedReference(t.db as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedReference(t.db as any);
    const r = await t.db.execute(sql`select (select count(*) from nutrients)::int as n, (select count(*) from nutrient_references)::int as d, (select count(*) from drug_food_interactions)::int as i, (select count(*) from activities)::int as a`);
    const row = r.rows[0] as { n: number; d: number; i: number; a: number };
    expect(row.n).toBeGreaterThan(50);
    expect(row.d).toBeGreaterThan(300);
    expect(row.i).toBeGreaterThan(15);
    expect(row.a).toBeGreaterThan(30);
  });
});
