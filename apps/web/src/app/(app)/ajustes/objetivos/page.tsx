import { Suspense } from "react";
import { Lock, Pencil } from "lucide-react";
import { asc, desc, eq, targetSets } from "@nutria/db";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty, Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { n0, nutrient, nutrientName } from "@/lib/format";
import { requireScope } from "@/lib/session";
import { NewSpecialSet, Recalc, TargetEditor, TargetRowActions, type TargetSet } from "./targets-client";

export const metadata = { title: "Objetivos" };

const MODE: Record<string, string> = { fixed: "fijo", dynamic: "calculado", adaptive: "adaptativo" };
const SOURCE: Record<string, string> = { formula: "fórmula", adaptive: "TDEE real", manual: "manual", condition: "condición" };
const DAYS = ["L", "M", "X", "J", "V", "S", "D"];

async function Content() {
  const ctx = await requireScope("diary");
  const pid = ctx.person.id;
  const sets = await db().select().from(targetSets).where(eq(targetSets.personId, pid)).orderBy(desc(targetSets.isDefault), asc(targetSets.createdAt));
  const base = sets.find((s) => s.isDefault) ?? sets[0];
  if (!base)
    return (
      <Card>
        <Empty title="Aún no hay objetivos">Completa tu perfil (sexo, edad, altura y peso) y pulsa recalcular.</Empty>
        {ctx.canWrite ? <Recalc personId={pid} /> : null}
      </Card>
    );
  const toSet = (s: typeof base): TargetSet => ({ id: s.id, name: s.name, kcal: Math.round(s.kcal), protein: Math.round(s.protein), carbs: Math.round(s.carbs), fat: Math.round(s.fat), fiber: s.fiber ? Math.round(s.fiber) : null, mode: s.mode as TargetSet["mode"], pinned: s.pinned, rule: s.rule, isDefault: s.isDefault });
  const micros = Object.entries(base.micros);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Energía y macros"
            action={
              ctx.canWrite ? (
                <div className="flex gap-2">
                  <Recalc personId={pid} />
                  <NewSpecialSet personId={pid} base={toSet(base)} />
                </div>
              ) : null
            }
          />
          <ul className="divide-y divide-line">
            {sets.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.name} <Badge>{MODE[s.mode] ?? s.mode}</Badge> <Badge tone="neutral">{SOURCE[s.source] ?? s.source}</Badge>
                  </p>
                  <p className="num text-sm text-ink-2">
                    {n0(s.kcal)} kcal · P {n0(s.protein)} g{s.pinned.includes("protein") ? <Lock className="ml-0.5 inline size-3" /> : null} · H {n0(s.carbs)} g{s.pinned.includes("carbs") ? <Lock className="ml-0.5 inline size-3" /> : null} · G {n0(s.fat)} g
                    {s.pinned.includes("fat") ? <Lock className="ml-0.5 inline size-3" /> : null}
                    {s.fiber ? ` · fibra ${n0(s.fiber)} g` : ""}
                  </p>
                  {!s.isDefault ? (
                    <p className="text-xs text-ink-3">
                      {s.rule.trainingDay ? "Días de entreno" : ""}
                      {s.rule.trainingDay && s.rule.days?.length ? " · " : ""}
                      {s.rule.days?.length ? s.rule.days.map((d) => DAYS[d - 1]).join(" ") : ""}
                    </p>
                  ) : null}
                </div>
                {ctx.canWrite ? (
                  <>
                    <TargetEditor
                      personId={pid}
                      initial={toSet(s)}
                      trigger={
                        <Button size="icon-sm" variant="ghost" aria-label="Editar">
                          <Pencil />
                        </Button>
                      }
                    />
                    <TargetRowActions personId={pid} id={s.id} canDelete={!s.isDefault} />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">«Calculado» se actualiza al cambiar tu perfil o peso. «Adaptativo» usa tu gasto real cuando aceptas la propuesta semanal en Progreso. Los días especiales tienen prioridad sobre el conjunto diario.</p>
        </Card>
      </div>
      <Card>
        <CardHeader title="Micronutrientes" subtitle="Ingestas de referencia de la EFSA para tu perfil" />
        {micros.length ? (
          <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto text-sm">
            {micros.map(([code, r]) => (
              <li key={code} className="flex justify-between gap-2 py-1.5">
                <span>{nutrientName(code)}</span>
                <span className="num text-right text-ink-2">
                  {r.min != null ? nutrient(code, r.min) : ""}
                  {r.max != null ? <span className="text-xs text-ink-3"> {r.min != null ? "· " : ""}máx {nutrient(code, r.max)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Sin datos.</p>
        )}
      </Card>
    </div>
  );
}

export default function ObjetivosPage() {
  return (
    <>
      <PageHeader title="Objetivos" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}
