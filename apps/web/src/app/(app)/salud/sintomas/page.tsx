import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { and, avg, desc, eq, gte, insights, isNull, mealFeelings, symptomLogs } from "@nutria/db";
import { addDays, todayIn } from "@nutria/nutrition";
import { DeleteSymptom, RunCorrelations, SymptomForm } from "@/components/health/forms";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty, Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { n1, relativeDay, time } from "@/lib/format";
import { requireScope } from "@/lib/session";

export const metadata = { title: "Síntomas" };

async function Content() {
  const ctx = await requireScope("health");
  const pid = ctx.person.id;
  const tz = ctx.person.timezone;
  const today = todayIn(tz);
  const [logs, found, [feel]] = await Promise.all([
    db().select().from(symptomLogs).where(and(eq(symptomLogs.personId, pid), gte(symptomLogs.date, addDays(today, -30)))).orderBy(desc(symptomLogs.occurredAt)).limit(60),
    db()
      .select()
      .from(insights)
      .where(and(eq(insights.personId, pid), eq(insights.kind, "symptom_correlation"), isNull(insights.dismissedAt)))
      .orderBy(desc(insights.score))
      .limit(8),
    db()
      .select({ hunger: avg(mealFeelings.hungerBefore), satiety: avg(mealFeelings.satietyAfter), mood: avg(mealFeelings.mood) })
      .from(mealFeelings)
      .where(and(eq(mealFeelings.personId, pid), gte(mealFeelings.date, addDays(today, -14)))),
  ]);
  const counts = new Map<string, number>();
  for (const l of logs) counts.set(l.symptom, (counts.get(l.symptom) ?? 0) + 1);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        {ctx.canWrite ? (
          <Card>
            <CardHeader title="Anotar un síntoma" subtitle="Cuantos más registres, mejor se detectan los patrones con lo que comes" />
            <SymptomForm personId={pid} />
          </Card>
        ) : null}
        <Card>
          <CardHeader title="Últimos 30 días" subtitle={[...counts].map(([k, v]) => `${k} ×${v}`).join(" · ") || undefined} />
          {logs.length ? (
            <ul className="divide-y divide-line text-sm">
              {logs.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2">
                  <span className="w-28 text-ink-3">
                    {relativeDay(l.date, today)} {time(l.occurredAt, tz)}
                  </span>
                  <span className="flex-1">
                    <b className="font-medium">{l.symptom}</b> <span className="text-ink-3">{"●".repeat(l.intensity)}{"○".repeat(5 - l.intensity)}</span>
                    {l.note ? <span className="block text-xs text-ink-3">{l.note}</span> : null}
                  </span>
                  {ctx.canWrite ? <DeleteSymptom personId={pid} id={l.id} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Sin síntomas registrados" />
          )}
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Posibles relaciones" action={ctx.canWrite ? <RunCorrelations personId={pid} /> : null} />
          <p className="mb-3 text-xs text-ink-3">Alimentos que aparecen entre 2 y 24 h antes de un síntoma más a menudo de lo esperable. Correlación no es causa: coméntalo con un profesional antes de eliminar alimentos.</p>
          {found.length ? (
            <ul className="space-y-2">
              {found.map((i) => (
                <li key={i.id} className="rounded-xl bg-paper-2 p-3 text-sm">
                  <p className="flex items-center gap-2 font-medium">
                    <Sparkles className="size-4 text-persimmon" /> {i.title}
                  </p>
                  {i.score != null ? <Badge className="mt-1">fuerza {Math.round(i.score * 100)} %</Badge> : null}
                  <div className="mt-1 text-ink-2">
                    <Markdown text={i.bodyMd} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">Aún no hay suficientes datos. Se analiza cada semana.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Sensaciones (14 días)" subtitle="Anotadas desde el diario" />
          <dl className="grid grid-cols-3 gap-2 text-center text-sm">
            {[
              ["Hambre antes", feel?.hunger],
              ["Saciedad", feel?.satiety],
              ["Ánimo", feel?.mood],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-xl bg-paper-2 p-2">
                <dt className="text-xs text-ink-3">{k}</dt>
                <dd className="num font-display text-xl font-semibold">{v ? n1(Number(v)) : "—"}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}

export default function SintomasPage() {
  return (
    <>
      <PageHeader title="Síntomas y sensaciones" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}
