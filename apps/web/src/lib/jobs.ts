import "server-only";
import { PgBoss } from "pg-boss";
import type { JobName, JobPayloads } from "@nutria/core";

declare global {
  var __nutriaBoss: Promise<PgBoss> | undefined;
}

/** Send-only pg-boss client: the worker owns schema, schedules and supervision. */
function boss() {
  globalThis.__nutriaBoss ??= (async () => {
    const b = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss", supervise: false, schedule: false, migrate: false, application_name: "nutria-web" } as ConstructorParameters<typeof PgBoss>[0]);
    b.on("error", (e: Error) => console.error(JSON.stringify({ svc: "web", msg: "pg-boss", error: e.message })));
    await b.start();
    return b;
  })();
  return globalThis.__nutriaBoss;
}

export async function enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts: { singletonKey?: string; startAfter?: number } = {}) {
  try {
    return await (await boss()).send(name, data as object, opts as never);
  } catch (e) {
    // Jobs are best-effort from the web: never fail a user request because the queue is down.
    // Forget the client so the next call reconnects (a rejected start would otherwise stick until restart).
    globalThis.__nutriaBoss = undefined;
    console.error(JSON.stringify({ svc: "web", msg: "enqueue failed", job: name, error: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}
