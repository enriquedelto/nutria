import { connection } from "next/server";
import { sql } from "@nutria/db";
import { db } from "@/lib/db";

/** Liveness/readiness for Docker and Caddy: checks the database. */
export async function GET() {
  await connection();
  const t = Date.now();
  try {
    await db().execute(sql`select 1`);
    return Response.json({ ok: true, db: "up", ms: Date.now() - t, version: process.env.APP_VERSION ?? "dev" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
