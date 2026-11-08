/** Per-user AI quota and usage accounting (ai_usage). */
import { aiUsage, and, eq, gte, sql, user, type Database } from "@nutria/db";
import { AiError, type AiUsage, type Backend } from "./types";

export interface QuotaConfig {
  /** Requests per user per day (admins are exempt). */
  dailyRequests: number;
  /** Estimated USD per user per month (only meaningful on the API backend). */
  monthlyUsd: number;
}

export function quotaConfig(env = process.env): QuotaConfig {
  return { dailyRequests: Number(env.AI_DAILY_LIMIT ?? 60), monthlyUsd: Number(env.AI_MONTHLY_USD ?? 10) };
}

export interface QuotaStatus {
  usedToday: number;
  dailyLimit: number;
  usdThisMonth: number;
  monthlyUsd: number;
  exempt: boolean;
}

export async function quotaStatus(db: Database, userId: string, cfg = quotaConfig(), now = new Date()): Promise<QuotaStatus> {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [[u], [day], [month]] = await Promise.all([
    db.select({ role: user.role }).from(user).where(eq(user.id, userId)).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(aiUsage).where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, dayStart))),
    db.select({ usd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float` }).from(aiUsage).where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, monthStart))),
  ]);
  return { usedToday: day?.n ?? 0, dailyLimit: cfg.dailyRequests, usdThisMonth: month?.usd ?? 0, monthlyUsd: cfg.monthlyUsd, exempt: u?.role === "admin" };
}

export async function assertQuota(db: Database, userId: string, backend: Backend, cfg = quotaConfig()) {
  if (backend === "mock") return;
  const s = await quotaStatus(db, userId, cfg);
  if (s.exempt) return;
  if (s.usedToday >= s.dailyLimit) throw new AiError(`Has llegado al límite diario de IA (${s.dailyLimit} peticiones). Mañana se renueva.`, "quota");
  if (backend === "api" && s.usdThisMonth >= s.monthlyUsd) throw new AiError("Has llegado al límite mensual de gasto en IA.", "quota");
}

export async function recordUsage(db: Database, row: { userId: string; feature: string; backend: Backend; usage?: AiUsage; ok?: string }) {
  await db.insert(aiUsage).values({
    userId: row.userId,
    feature: row.feature,
    backend: row.backend,
    model: row.usage?.model,
    inputTokens: row.usage?.inputTokens ?? 0,
    outputTokens: row.usage?.outputTokens ?? 0,
    costUsd: row.usage?.costUsd ?? null,
    durationMs: row.usage?.durationMs,
    ok: row.ok ?? "ok",
  });
}
