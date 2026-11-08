/**
 * In-memory Postgres (PGlite) with all migrations applied — for unit/integration tests.
 * Same SQL as production (pg_trgm + unaccent available).
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

export type TestDatabase = PgliteDatabase<typeof schema>;

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function createTestDb(): Promise<{ db: TestDatabase; client: PGlite; close: () => Promise<void> }> {
  const client = new PGlite({ extensions: { pg_trgm, unaccent } });
  const db = drizzle(client, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder });
  return { db, client, close: () => client.close() };
}
