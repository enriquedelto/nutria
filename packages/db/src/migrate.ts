import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL no está definida");

/** Snapshot before migrating (pg_dump must be available, e.g. inside the postgres container). */
function snapshot() {
  const dir = process.env.BACKUP_DIR;
  if (!dir || process.env.SKIP_PREMIGRATE_SNAPSHOT === "1") return;
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `premigrate-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`);
  try {
    // Password via env, never on the command line (it would end up in logs and ps).
    const u = new URL(url!);
    const env = { ...process.env, PGPASSWORD: decodeURIComponent(u.password) };
    u.password = "";
    execFileSync("pg_dump", ["--format=custom", `--file=${file}`, `--dbname=${u.toString()}`], { stdio: "inherit", env });
    console.log(`Snapshot: ${file}`);
  } catch (e) {
    console.warn("No se pudo hacer snapshot previo (¿pg_dump instalado y de la misma versión?). Código:", (e as { status?: number }).status ?? "?");
  }
}

snapshot();
const sql = postgres(url, { max: 1 });
await migrate(drizzle(sql), { migrationsFolder: join(here, "..", "migrations") });
await sql.end();
console.log("Migraciones aplicadas");
