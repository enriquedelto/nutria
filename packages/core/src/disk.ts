/**
 * Disk watch (job maintenance.disk). On 2026-11-11 the NUC disk filled up and Postgres PANICked
 * on a checkpoint: this writes the usage to <backups>/disk.json (shown in Admin) and pushes a
 * notification to the admin when usage crosses 85 % and 95 %, once per level.
 */
import { readFile, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sql, type Database } from "@nutria/db";
import { notify } from "./notify";
import { rowsOf } from "./util";

export type DiskLevel = "ok" | "warn" | "critical";

export interface DiskStatus {
  at: string;
  totalBytes: number;
  freeBytes: number;
  usedPct: number;
  level: DiskLevel;
  dbBytes: number | null;
  /** Highest level already notified; resets to "ok" once usage drops back. */
  notified: DiskLevel;
}

export const DISK_WARN_PCT = 85;
export const DISK_CRITICAL_PCT = 95;
const RANK: Record<DiskLevel, number> = { ok: 0, warn: 1, critical: 2 };

export function diskLevel(usedPct: number): DiskLevel {
  return usedPct >= DISK_CRITICAL_PCT ? "critical" : usedPct >= DISK_WARN_PCT ? "warn" : "ok";
}

/** Whether to notify: only when the level goes up past what was already notified. */
export function diskShouldNotify(level: DiskLevel, notified: DiskLevel): boolean {
  return RANK[level] > RANK[notified];
}

const gb = (n: number) => `${(n / 1_073_741_824).toLocaleString("es-ES", { maximumFractionDigits: 1 })} GB`;

export async function readDiskStatus(dir: string): Promise<DiskStatus | null> {
  try {
    return JSON.parse(await readFile(join(dir, "disk.json"), "utf8")) as DiskStatus;
  } catch {
    return null;
  }
}

export async function checkDisk(db: Database, dir = process.env.BACKUP_DIR ?? "/data/backups"): Promise<DiskStatus> {
  const s = await statfs(dir);
  const totalBytes = s.blocks * s.bsize;
  // bavail: what an unprivileged writer (Postgres) can still use.
  const freeBytes = s.bavail * s.bsize;
  const usedPct = totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10 : 0;
  const level = diskLevel(usedPct);
  let dbBytes: number | null = null;
  try {
    dbBytes = Number(rowsOf<{ n: string | number }>(await db.execute(sql`select pg_database_size(current_database()) as n`))[0]?.n ?? 0);
  } catch {
    dbBytes = null;
  }
  const prev = await readDiskStatus(dir);
  // When usage drops, lower the mark too, so a later rise is notified again.
  const before = prev?.notified ?? "ok";
  let notified: DiskLevel = RANK[before] > RANK[level] ? level : before;
  if (diskShouldNotify(level, notified)) {
    const admin = rowsOf<{ id: string }>(await db.execute(sql`select id from "user" where role = 'admin' order by created_at limit 1`))[0];
    if (admin) {
      await notify(db, {
        userId: admin.id,
        type: "system",
        title: level === "critical" ? `🛑 Disco casi lleno (${usedPct} %)` : `⚠️ Disco al ${usedPct} %`,
        body: `Quedan ${gb(freeBytes)} libres en el servidor. Si se llena, la base de datos se detiene. Revisa 'docker system df'.`,
        url: "/admin",
        tag: "disk",
        respectQuietHours: level !== "critical",
      });
    }
    notified = level;
  }
  const status: DiskStatus = { at: new Date().toISOString(), totalBytes, freeBytes, usedPct, level, dbBytes, notified };
  await writeFile(join(dir, "disk.json"), JSON.stringify(status));
  return status;
}
