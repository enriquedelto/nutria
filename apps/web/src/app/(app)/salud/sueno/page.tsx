import { Suspense } from "react";
import { and, asc, dailySummaries, eq, gte, sleepLogs } from "@nutria/db";
import { addDays, todayIn } from "@nutria/nutrition";
import { SeriesChart } from "@/components/charts/weight-chart";
import { SleepForm } from "@/components/health/forms";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { n0, n1, relativeDay, time } from "@/lib/format";
import { requireScope } from "@/lib/session";

export const metadata = { title: "Sueño" };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

async function Content() {
  const ctx = await requireScope("health");
  const pid = ctx.person.id;
  const tz = ctx.person.timezone;
  const today = todayIn(tz);
  const from = addDays(today, -59);
  const [logs, days] = await Promise.all([
    db().select().from(sleepLogs).where(and(eq(sleepLogs.personId, pid), gte(sleepLogs.date, from))).orderBy(asc(sleepLogs.date)),
    ctx.scopes.has("diary")
      ? db().select({ date: dailySummaries.date, kcal: dailySummaries.kcal }).from(dailySummaries).where(and(eq(dailySummaries.personId, pid), gte(dailySummaries.date, from), gte(dailySummaries.entries, 1)))
      : Promise.resolve([]),
  ]);
  const kcal = new Map(days.map((d) => [d.date, d.kcal]));
  const last30 = logs.filter((l) => l.date >= addDays(today, -29));
  const short = logs.filter((l) => l.hours < 6.5 && kcal.has(l.date)).map((l) => kcal.get(l.date)!);
  const rested = logs.filter((l) => l.hours >= 7 && kcal.has(l.date)).map((l) => kcal.get(l.date)!);
  const diff = short.length >= 3 && rested.length >= 3 ? avg(short)! - avg(rested)! : null;
  const bedtimes = last30.filter((l) => l.bedtime).map((l) => {
    const [h, m] = time(l.bedtime!, tz).split(":").map(Number);
    return ((h! + 12) % 24) * 60 + m!; // minutes since noon, so 23:00 and 01:00 average sensibly
  });
  const bedAvg = avg(bedtimes);
  const bedStr = bedAvg != null ? `${String(Math.floor((bedAvg / 60 + 12) % 24)).padStart(2, "0")}:${String(Math.round(bedAvg % 60)).padStart(2, "0")}` : "—";

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <Card>
          <CardHeader title="Horas de sueño" subtitle="Últimos 30 días" />
          <SeriesChart data={Array.from({ length: 30 }, (_, i) => addDays(today, i - 29)).map((d) => ({ date: d, value: last30.find((l) => l.date === d)?.hours ?? null }))} target={7.5} unit="h" color="var(--macro-carbs, var(--herb))" />
        </Card>
        {ctx.canWrite ? (
          <Card>
            <CardHeader title="Anotar la noche" />
            <SleepForm personId={pid} today={today} />
          </Card>
        ) : null}
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Media 30 días" />
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Horas", n1(avg(last30.map((l) => l.hours)))],
              ["Calidad", n1(avg(last30.filter((l) => l.quality).map((l) => l.quality!)))],
              ["Acostarse", bedStr],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-paper-2 p-2">
                <dt className="text-xs text-ink-3">{k}</dt>
                <dd className="num font-display text-lg font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <CardHeader title="Sueño y comida" />
          {diff != null ? (
            <p className="text-sm text-ink-2">
              Los días tras dormir menos de 6,5 h comes de media <b className="num">{n0(Math.abs(diff))} kcal {diff >= 0 ? "más" : "menos"}</b> que tras dormir 7 h o más.
              {diff > 150 ? " Dormir bien es una de las palancas más fáciles para controlar el apetito." : ""}
            </p>
          ) : (
            <p className="text-sm text-ink-2">Con unas semanas de sueño y diario te diré si dormir poco cambia lo que comes.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Últimas noches" />
          {!logs.length ? <p className="text-sm text-ink-2">Aún no hay noches anotadas. Anótalas aquí o llegarán solas desde el móvil (Ajustes › Integraciones).</p> : null}
          <ul className="divide-y divide-line text-sm">
            {[...logs].reverse().slice(0, 10).map((l) => (
              <li key={l.id} className="flex justify-between py-1.5">
                <span className="text-ink-3">{relativeDay(l.date, today)}</span>
                <span className="num">
                  {n1(l.hours)} h {l.quality ? ["😫", "😕", "😐", "🙂", "😴"][l.quality - 1] : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

export default function SuenoPage() {
  return (
    <>
      <PageHeader title="Sueño" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}
