import { Suspense } from "react";
import { desc, eq, fastingSessions } from "@nutria/db";
import { FASTING_PROTOCOLS } from "@nutria/nutrition";
import { FastingTimer } from "@/components/health/forms";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { dateShort, n1, time } from "@/lib/format";
import { requireScope } from "@/lib/session";

export const metadata = { title: "Ayuno" };

async function Content() {
  const ctx = await requireScope("diary");
  const pid = ctx.person.id;
  const tz = ctx.person.timezone;
  const sessions = await db().select().from(fastingSessions).where(eq(fastingSessions.personId, pid)).orderBy(desc(fastingSessions.startedAt)).limit(40);
  const active = sessions.find((s) => !s.endedAt) ?? null;
  const done = sessions.filter((s) => s.endedAt);
  const hours = (s: (typeof done)[number]) => (s.endedAt!.getTime() - s.startedAt.getTime()) / 3_600_000;
  const completed = done.filter((s) => hours(s) >= s.targetHours);
  const avgH = done.length ? done.reduce((a, s) => a + hours(s), 0) / done.length : null;
  const longest = done.length ? Math.max(...done.map(hours)) : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader title={active ? "Ayuno en curso" : "Empezar un ayuno"} subtitle={active ? `Desde las ${time(active.startedAt, tz)} del ${dateShort(active.startedAt.toISOString().slice(0, 10))}` : "Te avisaremos al llegar a la meta"} />
        <FastingTimer
          personId={pid}
          canWrite={ctx.canWrite}
          active={active ? { startedAt: active.startedAt.toISOString(), targetHours: active.targetHours, protocol: active.protocol } : null}
          protocols={FASTING_PROTOCOLS.map((p) => ({ ...p }))}
        />
        <p className="mt-4 text-xs text-ink-3">Las fases son aproximadas y varían entre personas. Si tienes diabetes, estás embarazada, das el pecho o tienes historial de trastornos alimentarios, consulta antes de ayunar.</p>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Resumen" />
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Completados", `${completed.length}/${done.length}`],
              ["Media", avgH ? `${n1(avgH)} h` : "—"],
              ["Récord", longest ? `${n1(longest)} h` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-paper-2 p-2">
                <dt className="text-xs text-ink-3">{k}</dt>
                <dd className="num font-display text-lg font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <CardHeader title="Historial" />
          {done.length ? (
            <ul className="divide-y divide-line text-sm">
              {done.slice(0, 20).map((s) => (
                <li key={s.id} className="flex items-center gap-2 py-2">
                  <span className="w-16 text-ink-3">{dateShort(s.startedAt.toISOString().slice(0, 10))}</span>
                  <span className="num flex-1">
                    {n1(hours(s))} h <span className="text-ink-3">/ {s.targetHours} h</span>
                  </span>
                  {hours(s) >= s.targetHours ? <Badge tone="ok">✓</Badge> : <Badge>{s.protocol}</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">Aún no has completado ningún ayuno.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function AyunoPage() {
  return (
    <>
      <PageHeader title="Ayuno" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}
