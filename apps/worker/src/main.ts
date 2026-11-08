/**
 * Nutria worker: pg-boss queues + cron (Europe/Madrid). All business logic lives in @nutria/core;
 * here we only wire jobs, fan out per-person work and log.
 */
import { PgBoss } from "pg-boss";
import { closeDb, getDb } from "@nutria/db";
import { JOBS, SCHEDULES, type JobName, type JobPayloads } from "@nutria/core";
import { handlers } from "./handlers";
import { log } from "./log";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL no está definida");

const boss = new PgBoss({ connectionString: url, schema: "pgboss", application_name: "nutria-worker" } as ConstructorParameters<typeof PgBoss>[0]);
boss.on("error", (e: Error) => log.error("pg-boss", { error: e.message }));

/** Queue options: heavy imports get long expirations and a single worker. */
const HEAVY = new Set<JobName>([JOBS.offMirror, JOBS.ciqualImport, JOBS.storeCrawl, JOBS.translateFoods]);

async function main() {
  const db = getDb(url);
  await boss.start();
  for (const name of Object.values(JOBS)) {
    await boss.createQueue(name, {
      retryLimit: name === JOBS.webhookDeliver ? 5 : 2,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: HEAVY.has(name) ? 6 * 3600 : 15 * 60,
    } as Parameters<typeof boss.createQueue>[1]);
  }
  for (const s of SCHEDULES) await boss.schedule(s.name, s.cron, {}, { tz: "Europe/Madrid" });

  for (const [name, handler] of Object.entries(handlers) as [JobName, (data: unknown, ctx: { db: typeof db; boss: PgBoss; signal: AbortSignal }) => Promise<unknown>][]) {
    await boss.work<JobPayloads[typeof name]>(name, { localConcurrency: HEAVY.has(name) ? 1 : 4 } as never, async (jobs) => {
      for (const job of jobs) {
        const start = Date.now();
        try {
          const out = await handler(job.data, { db, boss, signal: job.signal });
          log.info("job ok", { job: name, id: job.id, ms: Date.now() - start, out: summarize(out) });
        } catch (e) {
          log.error("job failed", { job: name, id: job.id, ms: Date.now() - start, error: e instanceof Error ? e.message : String(e) });
          throw e;
        }
      }
    });
  }
  log.info("worker listo", { queues: Object.values(JOBS).length, schedules: SCHEDULES.length });
}

function summarize(out: unknown) {
  if (out == null || typeof out !== "object") return out;
  if (Array.isArray(out)) return { count: out.length };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => typeof v !== "object").slice(0, 8));
}

async function shutdown(signal: string) {
  log.info("parando", { signal });
  await boss.stop({ graceful: true, timeout: 30_000 } as never);
  await closeDb();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((e) => {
  log.error("arranque fallido", { error: e instanceof Error ? e.stack : String(e) });
  process.exit(1);
});
