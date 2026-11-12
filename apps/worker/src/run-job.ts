/**
 * Run one job handler right now, in this process, and print its result and how long it took.
 * For checks by hand (weekly report with the real AI, the Monday check-in…):
 *   docker compose exec worker pnpm --filter @nutria/worker job report.weekly '{"personId":"<uuid>"}'
 * Anything the handler enqueues (webhooks, notifications) goes to the real queue.
 */
import { PgBoss } from "pg-boss";
import { closeDb, getDb } from "@nutria/db";
import { JOBS, type JobName } from "@nutria/core";
import { handlers } from "./handlers";

const [name, payload = "{}"] = process.argv.slice(2);
const names = Object.values(JOBS) as string[];
if (!name || !names.includes(name)) {
  console.error(`Uso: job <nombre> [json]\nJobs: ${names.sort().join(", ")}`);
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL no está definida");
const db = getDb(url);
const boss = new PgBoss({ connectionString: url, schema: "pgboss", application_name: "nutria-job" } as ConstructorParameters<typeof PgBoss>[0]);
boss.on("error", (e: Error) => console.error("pg-boss:", e.message));
await boss.start();
const started = Date.now();
let code = 0;
try {
  const run = handlers[name as JobName] as (data: unknown, ctx: Parameters<(typeof handlers)[JobName]>[1]) => Promise<unknown>;
  const result = await run(JSON.parse(payload), { db, boss, signal: new AbortController().signal });
  console.log(JSON.stringify({ job: name, seconds: Math.round((Date.now() - started) / 100) / 10, result }));
} catch (e) {
  code = 1;
  console.error(`✘ ${name}: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await boss.stop({ graceful: false }).catch(() => undefined);
  await closeDb();
}
process.exit(code);
