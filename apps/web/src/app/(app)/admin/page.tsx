import { Suspense } from "react";
import { connection } from "next/server";
import { aiEstimates, aiUsage, and, asc, auditLog, count, desc, eq, foods, gte, sql, user } from "@nutria/db";
import { rowsOf } from "@nutria/core";
import { quotaConfig } from "@nutria/ai";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { dateShort, n0, n1 } from "@/lib/format";
import { requireAdmin } from "@/lib/session";
import { hoursAgo } from "@/lib/utils";
import { aiConfigured } from "@/lib/ai";
import { InviteHousehold, RoleToggle, RunJob, ResetLink } from "./admin-client";

import { BackupsCard, DiskCard } from "./backups";
export const metadata = { title: "Administración" };

type JobRow = { name: string; state: string; n: number };
type FailedRow = { id: string; name: string; completed_on: string | null; output: unknown };

async function jobStats() {
  try {
    const [byState, failed] = await Promise.all([
      db().execute(sql`select name, state::text as state, count(*)::int as n from pgboss.job where created_on > now() - interval '7 days' group by 1, 2 order by 1`),
      db().execute(sql`select id::text, name, completed_on::text, output from pgboss.job where state = 'failed' order by completed_on desc nulls last limit 10`),
    ]);
    return { byState: rowsOf<JobRow>(byState), failed: rowsOf<FailedRow>(failed), ok: true as const };
  } catch {
    return { byState: [], failed: [], ok: false as const };
  }
}

async function Content() {
  const me = await requireAdmin();
  // The session read is a private cache, not a dynamic access: opt in before using the clock.
  await connection();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);
  const cfg = quotaConfig();
  const [users, usage, byFeature, sources, resets, jobs, recentAudit, [meals]] = await Promise.all([
    db().select({ id: user.id, name: user.name, email: user.email, role: user.role, twoFactor: user.twoFactorEnabled, createdAt: user.createdAt }).from(user).orderBy(asc(user.createdAt)),
    db()
      .select({ userId: aiUsage.userId, today: sql<number>`count(*) filter (where ${aiUsage.createdAt} >= ${dayStart.toISOString()})`.mapWith(Number), month: count(), usd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)`.mapWith(Number), errors: sql<number>`count(*) filter (where ${aiUsage.ok} <> 'ok')`.mapWith(Number) })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, monthStart))
      .groupBy(aiUsage.userId),
    db().select({ feature: aiUsage.feature, n: count(), tokens: sql<number>`sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens})`.mapWith(Number), ms: sql<number>`avg(${aiUsage.durationMs})`.mapWith(Number) }).from(aiUsage).where(gte(aiUsage.createdAt, monthStart)).groupBy(aiUsage.feature).orderBy(desc(count())),
    db().select({ source: foods.source, n: count(), last: sql<string>`max(${foods.updatedAt})::text` }).from(foods).groupBy(foods.source),
    db().select().from(auditLog).where(and(eq(auditLog.action, "password_reset_requested"), gte(auditLog.createdAt, hoursAgo(1)))).orderBy(desc(auditLog.createdAt)).limit(10),
    jobStats(),
    db().select({ a: auditLog, who: user.name }).from(auditLog).leftJoin(user, eq(user.id, auditLog.userId)).orderBy(desc(auditLog.createdAt)).limit(25),
    // Photo/text logging, last 30 days: a corrected or re-analysed estimate counts once (the superseded ones are left out).
    db()
      .select({
        total: count(),
        abandoned: sql<number>`count(*) filter (where ${aiEstimates.status} = 'discarded' or (${aiEstimates.status} = 'pending' and ${aiEstimates.createdAt} < now() - interval '24 hours'))`.mapWith(Number),
        medianS: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${aiEstimates.confirmedAt} - ${aiEstimates.createdAt}))) filter (where ${aiEstimates.status} = 'confirmed')`.mapWith((v) => (v == null ? null : Number(v))),
      })
      .from(aiEstimates)
      .where(and(eq(aiEstimates.kind, "meal"), gte(aiEstimates.createdAt, hoursAgo(24 * 30)), sql`${aiEstimates.status} <> 'superseded'`)),
  ]);
  const use = new Map(usage.map((u) => [u.userId, u]));
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const jobNames = [...new Set(jobs.byState.map((j) => j.name))];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card className="xl:col-span-2">
        <CardHeader title="Usuarios" subtitle={`${users.length} cuentas · IA: ${cfg.dailyRequests} peticiones/día por persona (admins sin límite) · ${process.env.AI_BACKEND ?? "subscription"}${aiConfigured() ? "" : " (sin configurar: falta el token o la clave)"}`} action={<InviteHousehold />} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-3">
              <tr>
                <th className="py-1 font-medium">Nombre</th>
                <th className="font-medium">Alta</th>
                <th className="text-right font-medium">IA hoy</th>
                <th className="text-right font-medium">IA mes</th>
                <th className="text-right font-medium">$ mes</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => {
                const s = use.get(u.id);
                const near = u.role !== "admin" && (s?.today ?? 0) >= cfg.dailyRequests * 0.8;
                return (
                  <tr key={u.id}>
                    <td className="py-2">
                      <span className="block font-medium">
                        {u.name} {u.role === "admin" ? <Badge tone="herb">admin</Badge> : null} {u.twoFactor ? <Badge tone="ok">2FA</Badge> : null}
                      </span>
                      <span className="text-xs text-ink-3">{u.email}</span>
                    </td>
                    <td className="text-xs text-ink-3">{dateShort(u.createdAt.toISOString().slice(0, 10))}</td>
                    <td className={`num text-right ${near ? "font-semibold text-persimmon" : ""}`}>{n0(s?.today ?? 0)}</td>
                    <td className="num text-right">
                      {n0(s?.month ?? 0)}
                      {s?.errors ? <span className="text-xs text-danger"> ({s.errors} err)</span> : null}
                    </td>
                    <td className="num text-right">{s?.usd ? n1(s.usd) : "—"}</td>
                    <td className="text-right whitespace-nowrap">
                      <ResetLink userId={u.id} />
                      {u.id !== me.id ? <RoleToggle userId={u.id} role={u.role as "admin" | "member"} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {resets.length ? (
          <div className="mt-3 rounded-lg border border-persimmon/40 bg-persimmon-soft p-3 text-sm">
            <p className="font-medium">Peticiones de contraseña (última hora)</p>
            <ul className="mt-1 space-y-1">
              {resets.map((r) => (
                <li key={r.id} className="truncate text-xs">
                  {nameOf.get(r.resourceId ?? "") ?? r.resourceId}: <code className="select-all">{String((r.meta as { url?: string }).url ?? "")}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="IA este mes" subtitle="Por función" />
        {meals && meals.total ? (
          <p className="mb-2 rounded-xl bg-paper-2 px-3 py-2 text-sm">
            Registro con IA (30 días): <span className="num font-medium">{meals.medianS != null ? `${n0(meals.medianS)} s` : "—"}</span> de mediana hasta guardar ·{" "}
            <span className="num font-medium">{n0((meals.abandoned / meals.total) * 100)} %</span> sin guardar ({n0(meals.total)} análisis)
          </p>
        ) : null}
        <ul className="divide-y divide-line text-sm">
          {byFeature.map((f) => (
            <li key={f.feature} className="flex justify-between py-1.5">
              <span>{f.feature}</span>
              <span className="num text-ink-2">
                {n0(f.n)} · {n0(f.tokens / 1000)}k tok · {n1((f.ms ?? 0) / 1000)} s
              </span>
            </li>
          ))}
          {!byFeature.length ? <li className="py-2 text-ink-3">Sin uso todavía.</li> : null}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Base de alimentos" subtitle="Espejo de Open Food Facts, CIQUAL y propios" action={<RunJob job="offMirror" label="Actualizar OFF" />} />
        <ul className="divide-y divide-line text-sm">
          {sources.map((s) => (
            <li key={s.source} className="flex justify-between py-1.5">
              <span>{s.source}</span>
              <span className="num text-ink-2">
                {n0(s.n)} · {s.last ? dateShort(s.last.slice(0, 10)) : "—"}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <RunJob job="ciqualImport" label="Reimportar CIQUAL" />
          <RunJob job="storeCrawl" label="Catálogo de Mercadona" />
        </div>
      </Card>

      <DiskCard />
      <BackupsCard />

      <Card>
        <CardHeader title="Trabajos (7 días)" subtitle={jobs.ok ? "Cola pg-boss" : "No se pudo leer la cola (¿worker sin arrancar?)"} />
        <ul className="divide-y divide-line text-sm">
          {jobNames.map((n) => (
            <li key={n} className="flex items-center justify-between gap-2 py-1.5">
              <span className="truncate">{n}</span>
              <span className="flex gap-1">
                {jobs.byState
                  .filter((j) => j.name === n)
                  .map((j) => (
                    <Badge key={j.state} tone={j.state === "failed" ? "danger" : j.state === "completed" ? "ok" : j.state === "active" ? "accent" : "neutral"}>
                      {j.state} {j.n}
                    </Badge>
                  ))}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <RunJob job="gamification" label="Logros y retos" />
          <RunJob job="tdeeWeekly" label="TDEE semanal" />
          <RunJob job="opengymSyncAll" label="Sincronizar openGym" />
          <RunJob job="cleanup" label="Limpieza" />
        </div>
        {jobs.failed.length ? (
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-danger">Últimos fallos</summary>
            <ul className="mt-1 space-y-1">
              {jobs.failed.map((f) => (
                <li key={f.id} className="truncate">
                  <b>{f.name}</b> {f.completed_on?.slice(0, 16)} — {JSON.stringify(f.output)?.slice(0, 160)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Auditoría" subtitle="Últimos 25 eventos" />
        <ul className="divide-y divide-line text-xs">
          {recentAudit.map(({ a, who }) => (
            <li key={a.id} className="flex gap-2 py-1.5">
              <span className="num w-28 shrink-0 text-ink-3">{a.createdAt.toISOString().slice(5, 16).replace("T", " ")}</span>
              <span className="truncate">
                <b className="font-medium">{who ?? "sistema"}</b> {a.action} {a.resource}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export default function AdminPage() {
  return (
    <>
      <PageHeader title="Administración" subtitle="Usuarios, IA, datos y trabajos" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}
