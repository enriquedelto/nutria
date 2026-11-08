import { Suspense } from "react";
import { aiEstimates, and, asc, desc, eq, inArray, labParameters, labReports, labResults } from "@nutria/db";
import { Sparkline } from "@/components/charts/sparkline";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty, Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { dateShort, n1, nutrientName } from "@/lib/format";
import { requireScope } from "@/lib/session";
import { DeleteReport, LabUpload, type LabDraft, type LabRow } from "./lab-client";

export const metadata = { title: "Analíticas" };

async function Content() {
  const ctx = await requireScope("labs");
  const pid = ctx.person.id;
  const [params, reports, results] = await Promise.all([
    db().select({ code: labParameters.code, nameEs: labParameters.nameEs, unit: labParameters.unit, relatedNutrient: labParameters.relatedNutrient, category: labParameters.category }).from(labParameters).orderBy(asc(labParameters.nameEs)),
    db().select().from(labReports).where(eq(labReports.personId, pid)).orderBy(desc(labReports.date)),
    db().select().from(labResults).where(eq(labResults.personId, pid)).orderBy(asc(labResults.date)),
  ]);
  const pendingIds = reports.filter((r) => r.status !== "confirmed" && r.aiEstimateId).map((r) => r.aiEstimateId!);
  const estimates = pendingIds.length ? await db().select({ id: aiEstimates.id, output: aiEstimates.output }).from(aiEstimates).where(and(inArray(aiEstimates.id, pendingIds))) : [];
  const drafts: LabDraft[] = reports
    .filter((r) => r.status !== "confirmed")
    .map((r) => ({ reportId: r.id, date: r.date, labName: r.labName, results: ((estimates.find((e) => e.id === r.aiEstimateId)?.output.results as LabRow[] | undefined) ?? []) }));

  // Group by parameter (or raw name when unmatched) for the evolution view.
  const pmap = new Map(params.map((p) => [p.code, p]));
  const series = new Map<string, { name: string; unit: string; points: typeof results; related: string | null }>();
  for (const r of results) {
    const key = r.parameterCode ?? `raw:${r.rawName.toLowerCase()}`;
    const p = r.parameterCode ? pmap.get(r.parameterCode) : undefined;
    const s = series.get(key) ?? { name: p?.nameEs ?? r.rawName, unit: r.unit, points: [], related: p?.relatedNutrient ?? null };
    s.points.push(r);
    series.set(key, s);
  }
  const rows = [...series.values()].sort((a, b) => Number(b.points.at(-1)!.flag !== "normal") - Number(a.points.at(-1)!.flag !== "normal") || a.name.localeCompare(b.name));
  const out = rows.filter((s) => s.points.at(-1)!.flag !== "normal");

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        {ctx.canWrite ? (
          <Card>
            <CardHeader title={drafts.length ? "Revisa la analítica" : "Añadir analítica"} />
            <LabUpload personId={pid} params={params} drafts={drafts} />
          </Card>
        ) : null}
        <Card>
          <CardHeader title="Evolución" subtitle="Último valor y tendencia de cada parámetro" />
          {rows.length ? (
            <ul className="divide-y divide-line">
              {rows.map((s) => {
                const last = s.points.at(-1)!;
                const prev = s.points.at(-2);
                return (
                  <li key={s.name} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[1fr_6rem_8rem]">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{s.name}</p>
                      <p className="text-xs text-ink-3">
                        {last.refLow != null || last.refHigh != null ? `Ref. ${last.refLow ?? "…"}–${last.refHigh ?? "…"} ${last.unit}` : "Sin rango"} · {dateShort(last.date)}
                        {prev ? ` · antes ${n1(prev.value)}` : ""}
                      </p>
                    </div>
                    <div className="hidden sm:block">{s.points.length > 1 ? <Sparkline values={s.points.map((p) => p.value)} color={last.flag === "normal" ? "var(--herb)" : "var(--persimmon)"} className="h-8 w-24" /> : null}</div>
                    <p className="num text-right font-semibold">
                      {n1(last.value)} <span className="text-xs font-normal text-ink-3">{last.unit}</span>{" "}
                      {last.flag === "high" ? <Badge tone="accent">alto</Badge> : last.flag === "low" ? <Badge tone="accent">bajo</Badge> : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty title="Sin analíticas">Sube un PDF o haz fotos a la hoja de resultados.</Empty>
          )}
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Fuera de rango" />
          {out.length ? (
            <ul className="space-y-2 text-sm">
              {out.map((s) => (
                <li key={s.name} className="rounded-xl bg-persimmon-soft/50 p-2">
                  <b>{s.name}</b> {s.points.at(-1)!.flag === "low" ? "bajo" : "alto"}
                  {s.related ? <span className="block text-xs text-ink-2">Relacionado con {nutrientName(s.related)}: el coach lo tendrá en cuenta al sugerirte alimentos.</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">Todo dentro de rango en la última analítica.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Informes" />
          {reports.length ? (
            <ul className="divide-y divide-line text-sm">
              {reports.map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-2">
                  <span className="flex-1">
                    {dateShort(r.date)} {r.labName ? <span className="text-ink-3">· {r.labName}</span> : null}
                  </span>
                  {r.status !== "confirmed" ? <Badge tone="warn">sin revisar</Badge> : <Badge tone="ok">{results.filter((x) => x.reportId === r.id).length} valores</Badge>}
                  {ctx.canWrite ? <DeleteReport personId={pid} id={r.id} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">Ninguno.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function AnaliticasPage() {
  return (
    <>
      <PageHeader title="Analíticas" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}
