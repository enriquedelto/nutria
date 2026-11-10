import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";
import { and, asc, avg, bodyMeasurements, dailySummaries, desc, eq, goals, gte, persons, progressPhotos, targetSets, tdeeEstimates, weightLogs } from "@nutria/db";
import { latestBulkReview } from "@nutria/core";
import { addDays, compositionSeries, continuous, daysBetween, daysToGoal, ffmiLabel, forecastWeight, MEASURE_SITES, SITE_LABEL, todayIn, trendWeights } from "@nutria/nutrition";
import { WeightChart, type WeightPoint } from "@/components/charts/weight-chart";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty, Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { dateLong, dateShort, kg, n0, n1 } from "@/lib/format";
import { requireScope } from "@/lib/session";
import { BulkCard } from "./bulk-card";
import { MeasureChart } from "./measure-chart";
import { AcceptTdee, GoalForm, MeasurementsForm, PhotoCompare, PhotoUpload, WeightForm, WeightList } from "./progress-forms";

export const metadata = { title: "Progreso" };


async function Content() {
  const ctx = await requireScope("body");
  const today = todayIn(ctx.person.timezone);
  const from = addDays(today, -180);
  const pid = ctx.person.id;
  const [weights, [estimate], [goal], measures, photos, [intake], [me]] = await Promise.all([
    db().select().from(weightLogs).where(and(eq(weightLogs.personId, pid), gte(weightLogs.date, from))).orderBy(asc(weightLogs.date)),
    db().select().from(tdeeEstimates).where(eq(tdeeEstimates.personId, pid)).orderBy(desc(tdeeEstimates.date)).limit(1),
    db().select().from(goals).where(and(eq(goals.personId, pid), eq(goals.status, "active"), eq(goals.type, "weight"))).limit(1),
    db().select().from(bodyMeasurements).where(eq(bodyMeasurements.personId, pid)).orderBy(desc(bodyMeasurements.date)).limit(400),
    ctx.scopes.has("photos") ? db().select().from(progressPhotos).where(eq(progressPhotos.personId, pid)).orderBy(desc(progressPhotos.date)) : Promise.resolve([]),
    db().select({ kcal: avg(dailySummaries.kcal) }).from(dailySummaries).where(and(eq(dailySummaries.personId, pid), gte(dailySummaries.date, addDays(today, -14)), gte(dailySummaries.entries, 1))),
    db().select({ goal: persons.goalType, adjust: targetSets.kcalAdjust, sex: persons.sex, heightCm: persons.heightCm }).from(persons).leftJoin(targetSets, and(eq(targetSets.personId, persons.id), eq(targetSets.isDefault, true))).where(eq(persons.id, pid)).limit(1),
  ]);
  const bulk = me?.goal === "gain" ? await latestBulkReview(db(), pid) : null;

  // Daily series (one weight per day, last value wins), smoothed trend, forecast.
  const perDay = new Map<string, number>();
  for (const w of weights) perDay.set(w.date, w.kg);
  const series = weights.length ? continuous([...perDay].map(([date, kgv]) => ({ date, weightKg: kgv })), weights[0]!.date, today) : [];
  const trend = trendWeights(series);
  const lastTrend = trend.filter((t): t is number => t != null).at(-1) ?? null;
  const trendAt = (daysAgo: number) => trend[trend.length - 1 - daysAgo] ?? null;
  const tdee = estimate?.adaptiveTdee ?? estimate?.formulaTdee ?? null;
  const avgIntake = intake?.kcal ? Number(intake.kcal) : null;
  const forecast = lastTrend && tdee && avgIntake ? forecastWeight({ fromDate: today, currentTrendKg: lastTrend, plannedIntake: avgIntake, tdee }) : [];
  const rate = forecast[0] && lastTrend ? ((forecast[0].weightKg - lastTrend) / 30) * 7 : null;
  const eta = goal && lastTrend && rate ? daysToGoal(lastTrend, goal.targetValue, rate) : null;

  const data: WeightPoint[] = series.map((p, i) => ({ date: p.date, kg: perDay.get(p.date) ?? null, trend: trend[i] ?? null }));
  if (forecast.length && lastTrend) {
    data[data.length - 1] = { ...data[data.length - 1]!, forecast: lastTrend };
    for (const f of forecast) data.push({ date: f.date, forecast: f.weightKg });
  }
  const latestBySite = new Map<string, { cm: number; date: string }>();
  for (const m of measures) if (!latestBySite.has(m.site)) latestBySite.set(m.site, { cm: m.cm, date: m.date });
  const siteSeries = MEASURE_SITES.map((s) => ({ key: s.key, label: s.label, unit: "cm", points: measures.filter((m) => m.site === s.key).map((m) => ({ date: m.date, value: m.cm })).reverse() }));
  const sitesShown = [...MEASURE_SITES.map((s) => s.key as string).filter((k) => latestBySite.has(k)), ...[...latestBySite.keys()].filter((k) => !(k in SITE_LABEL))];
  const comp = compositionSeries({ sex: me?.sex ?? null, heightCm: me?.heightCm ?? null, weights: weights.map((w) => ({ date: w.date, kg: w.kg, bodyFatPct: w.bodyFatPct })), measures });
  const lastComp = comp.at(-1) ?? null;
  const prevComp = lastComp ? ([...comp].reverse().find((c) => daysBetween(c.date, lastComp.date) >= 21) ?? null) : null;
  const signed = (v: number, unit: string) => `${v > 0 ? "+" : ""}${n1(v)} ${unit}`;
  const nearKg = (date: string) => {
    let best: { kg: number; d: number } | null = null;
    for (const w of weights) {
      const d = Math.abs(daysBetween(w.date, date));
      if (d <= 7 && (!best || d < best.d)) best = { kg: w.kg, d };
    }
    return best?.kg ?? null;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <Card>
          <CardHeader
            title={lastTrend ? kg(lastTrend) : "Peso"}
            subtitle={
              lastTrend ? (
                <span className="num">
                  Tendencia · 7 días {n1(lastTrend - (trendAt(7) ?? lastTrend))} kg · 30 días {n1(lastTrend - (trendAt(30) ?? lastTrend))} kg
                </span>
              ) : (
                "Registra tu peso para ver la tendencia"
              )
            }
            action={ctx.canWrite ? <GoalForm personId={pid} current={goal ? { targetValue: goal.targetValue, targetDate: goal.targetDate } : null} /> : null}
          />
          {data.length > 1 ? <WeightChart data={data} goal={goal?.targetValue} /> : <Empty title="Aún no hay suficientes pesajes" />}
          {ctx.canWrite ? (
            <div className="mt-4 border-t border-line pt-4">
              <WeightForm personId={pid} today={today} />
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Previsión" subtitle="Si sigues comiendo como las últimas dos semanas" />
          {forecast.length ? (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                {forecast.map((f) => (
                  <div key={f.days} className="rounded-xl bg-paper-2 p-3">
                    <p className="text-xs text-ink-3">{f.days} días</p>
                    <p className="num font-display text-xl font-semibold">{kg(f.weightKg)}</p>
                    <p className="text-[11px] text-ink-3">{dateShort(f.date)}</p>
                  </div>
                ))}
              </div>
              {goal ? (
                <p className="mt-3 text-sm text-ink-2">
                  Meta {kg(goal.targetValue)}: {eta ? <>llegarías hacia el <b>{dateLong(addDays(today, eta))}</b> ({n0(eta)} días).</> : "al ritmo actual no te acercas a la meta."}
                  {goal.targetDate && eta && addDays(today, eta) > goal.targetDate ? " Más tarde que tu fecha objetivo." : ""}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-ink-2">Necesito al menos unos días de diario y pesajes.</p>
          )}
        </Card>

        {me?.goal === "gain" ? <BulkCard personId={pid} review={bulk} kcalAdjust={me.adjust ?? 0} canWrite={ctx.canWrite} /> : null}

        <Card>
          <CardHeader title="Pesajes" />
          <WeightList personId={pid} items={[...weights].reverse().slice(0, 20)} canWrite={ctx.canWrite} />
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Gasto real (TDEE)" subtitle={estimate ? `Calculado el ${dateShort(estimate.date)}` : undefined} />
          {estimate ? (
            <div className="space-y-2 text-sm">
              <p className="num font-display text-3xl font-semibold">
                {n0(estimate.adaptiveTdee ?? estimate.formulaTdee)} <span className="text-base font-normal text-ink-2">kcal/día</span>
              </p>
              <p className="text-ink-2">
                Fórmula: {n0(estimate.formulaTdee)} · Media ingerida: {n0(estimate.avgIntake)} · {estimate.loggedDays}/{estimate.windowDays} días registrados
              </p>
              <Badge tone={estimate.confidence >= 0.6 ? "ok" : estimate.confidence >= 0.3 ? "warn" : "neutral"}>Confianza {Math.round(estimate.confidence * 100)} %</Badge>
              {estimate.underLoggingSuspected ? (
                <p className="flex gap-2 rounded-xl bg-warn/20 p-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /> El peso no cuadra con lo registrado: puede que falten comidas en el diario.
                </p>
              ) : null}
              {estimate.suggestedKcal && !estimate.acceptedAt && ctx.canWrite && estimate.confidence >= 0.4 ? (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-herb-soft/60 p-2">
                  <span>Objetivo sugerido: {n0(estimate.suggestedKcal)} kcal</span>
                  <AcceptTdee personId={pid} estimateId={estimate.id} kcal={Math.round(estimate.suggestedKcal)} />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-ink-2">Se calcula cada lunes cuando hay al menos 14 días de diario y varios pesajes.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Medidas" action={ctx.canWrite ? <MeasurementsForm personId={pid} today={today} /> : null} />
          {latestBySite.size ? (
            <ul className="space-y-1 text-sm">
              {sitesShown.map((site) => {
                const v = latestBySite.get(site)!;
                return (
                  <li key={site} className="flex justify-between">
                    <span>{SITE_LABEL[site] ?? site}</span>
                    <span className="num text-ink-2">
                      {n1(v.cm)} cm <span className="text-xs text-ink-3">· {dateShort(v.date)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">Sin medidas. Con la cinta métrica verás si lo que cambia es músculo o grasa.</p>
          )}
          <MeasureChart series={siteSeries} label="Medida que se muestra" />
        </Card>

        <Card id="composicion">
          <CardHeader title="Composición corporal" subtitle={lastComp ? `${lastComp.source === "navy" ? "Estimada con la cinta (cuello y cintura)" : "Con tu % de grasa medido"} · ${dateShort(lastComp.date)}` : undefined} />
          {lastComp ? (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-paper-2 p-2">
                  <p className="text-xs text-ink-3">Grasa</p>
                  <p className="num font-display text-xl font-semibold">{n1(lastComp.bodyFatPct)} %</p>
                </div>
                <div className="rounded-xl bg-paper-2 p-2">
                  <p className="text-xs text-ink-3">Masa magra</p>
                  <p className="num font-display text-xl font-semibold">{n1(lastComp.leanKg)} kg</p>
                </div>
                <div className="rounded-xl bg-paper-2 p-2">
                  <p className="text-xs text-ink-3">Masa grasa</p>
                  <p className="num font-display text-xl font-semibold">{n1(lastComp.fatKg)} kg</p>
                </div>
              </div>
              {prevComp ? (
                <p className="text-ink-2">
                  Desde el {dateShort(prevComp.date)}: magra <strong className="num">{signed(lastComp.leanKg - prevComp.leanKg, "kg")}</strong>, grasa <strong className="num">{signed(lastComp.fatKg - prevComp.fatKg, "kg")}</strong>.
                </p>
              ) : null}
              <p className="text-ink-2">
                FFMI <strong className="num">{n1(lastComp.ffmiNorm)}</strong>
                {me?.sex ? ` (${ffmiLabel(lastComp.ffmiNorm, me.sex)})` : ""}: masa magra para tu altura.
              </p>
              {lastComp.source === "navy" ? <p className="text-xs text-ink-3">La estimación con cinta tiene un error de ±3–4 puntos: fíate de la tendencia, no del número exacto.</p> : null}
              <MeasureChart
                label="Dato de composición que se muestra"
                series={[
                  { key: "lean", label: "Masa magra", unit: "kg", points: comp.map((c) => ({ date: c.date, value: c.leanKg })) },
                  { key: "fat", label: "Masa grasa", unit: "kg", points: comp.map((c) => ({ date: c.date, value: c.fatKg })) },
                  { key: "pct", label: "% de grasa", unit: "%", points: comp.map((c) => ({ date: c.date, value: c.bodyFatPct })) },
                ]}
              />
            </div>
          ) : (
            <p className="text-sm text-ink-3">
              {me?.heightCm ? `Mide cuello y cintura${me.sex === "female" ? " y cadera" : ""} el mismo día (con un pesaje esa semana) y estimaré tu % de grasa, o anótalo al registrar el peso si tu báscula lo da.` : "Falta tu altura en el perfil."}
            </p>
          )}
        </Card>

        {ctx.scopes.has("photos") ? (
          <Card>
            <CardHeader title="Fotos" action={ctx.canWrite ? <PhotoUpload personId={pid} today={today} /> : null} />
            <PhotoCompare photos={photos.map((p) => ({ id: p.id, date: p.date, pose: p.pose, kg: nearKg(p.date) }))} />
          </Card>
        ) : null}
      </div>
    </div>
  );
}

export default function ProgresoPage() {
  return (
    <>
      <PageHeader title="Progreso" actions={<Link href="/progreso/informe" className="text-sm font-medium text-herb">Informe semanal</Link>} />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}
