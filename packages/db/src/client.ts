import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Driver-agnostic handle (postgres.js in prod, PGlite in tests). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = PgDatabase<any, Schema>;

declare global {
  // eslint-disable-next-line no-var
  var __nutriaDb: { db: Database; sql: postgres.Sql } | undefined;
}

/** Singleton connection (survives Next.js dev hot reloads). */
export function getDb(url = process.env.DATABASE_URL): Database {
  if (!url) throw new Error("DATABASE_URL no está definida");
  if (!globalThis.__nutriaDb) {
    const sql = postgres(url, { max: Number(process.env.DB_POOL_MAX ?? 10), idle_timeout: 30, prepare: true });
    globalThis.__nutriaDb = { sql, db: drizzle(sql, { schema, casing: "snake_case" }) };
  }
  return globalThis.__nutriaDb.db;
}

export async function closeDb() {
  await globalThis.__nutriaDb?.sql.end({ timeout: 5 });
  globalThis.__nutriaDb = undefined;
}
