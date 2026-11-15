import { Suspense } from "react";
import { and, desc, eq, labResults, personConditions, persons } from "@nutria/db";
import { getSportProfile, latestWeight, personToday, supplementsForDate } from "@nutria/core";
import { NOT_NEEDED, SUPPLEMENTS } from "@nutria/nutrition";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { requireScope } from "@/lib/session";
import { CatalogItem, PlanList, type CatalogView } from "./supplements-client";

export const metadata = { title: "Suplementos" };

async function Content() {
  const ctx = await requireScope("diary");
  const pid = ctx.person.id;
  const today = await personToday(db(), pid);
  const [plans, w, sport, [p], conds, vitD] = await Promise.all([
    supplementsForDate(db(), pid, today, { all: true }),
    latestWeight(db(), pid),
    getSportProfile(db(), pid),
    db().select({ goal: persons.goalType, pregnancy: persons.pregnancy, isChild: persons.isChild }).from(persons).where(eq(persons.id, pid)).limit(1),
    ctx.scopes.has("health") ? db().select({ code: personConditions.conditionCode }).from(personConditions).where(and(eq(personConditions.personId, pid), eq(personConditions.active, true))) : Promise.resolve([]),
    ctx.scopes.has("labs") ? db().select({ value: labResults.value, refLow: labResults.refLow }).from(labResults).where(and(eq(labResults.personId, pid), eq(labResults.parameterCode, "vit_d_25oh"))).orderBy(desc(labResults.date)).limit(1) : Promise.resolve([]),
  ]);
  const kg = w?.kg ?? 70;
  const lowLabs = vitD[0] && vitD[0].value < (vitD[0].refLow ?? 30) ? ["vit_d_25oh"] : [];
  const codes = conds.map((c) => c.code);
  const trainingDays = sport.active && sport.profile.trainingDays?.length ? sport.profile.trainingDays : [1, 2, 3, 4, 5];
  const planned = new Set(plans.map((x) => x.code).filter(Boolean));
  const catalog: CatalogView[] = SUPPLEMENTS.map((s) => {
    const d = s.dose(kg);
    return {
      code: s.code,
      name: s.name,
      evidence: s.evidence,
      purpose: s.purpose,
      timing: s.timing,
      doseLabel: d.label,
      dose: d.amount,
      doseUnit: d.unit,
      grams: d.grams,
      defaultTime: s.defaultTime,
      days: s.days === "training" ? trainingDays : [1, 2, 3, 4, 5, 6, 7],
      cautions: s.cautions({ conditions: codes, pregnant: !!p?.pregnancy, lowLabs }),
      planned: planned.has(s.code),
      recommended: s.code === "creatine" ? sport.active || p?.goal === "gain" : s.code === "vit_d" ? lowLabs.length > 0 : false,
    };
  });
  const recommended = catalog.filter((c) => c.recommended || c.evidence === "A");
  const others = catalog.filter((c) => !recommended.includes(c));

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-ink-2">
        Para ganar músculo lo que más cuenta es entrenar con constancia, comer suficiente proteína y un pequeño superávit, y dormir bien. De los suplementos, solo la creatina tiene una evidencia sólida; el resto es opcional. Cada toma que marques queda en tu diario, así que la proteína en polvo suma a tus macros.
      </p>
      {p?.isChild ? <Card className="text-sm text-ink-2">En menores no se recomiendan suplementos deportivos salvo indicación médica.</Card> : null}

      <Card>
        <CardHeader title="Mis pautas" subtitle={plans.length ? "Márcalas como tomadas en Hoy; te avisamos a la hora si aún no lo has hecho." : "Aún no tienes ninguna. Añade una desde las recomendaciones."} />
        <PlanList personId={pid} canWrite={ctx.canWrite} plans={plans} />
      </Card>

      <Card>
        <CardHeader title="Recomendados para tu objetivo" subtitle={`Dosis calculadas para ${kg.toLocaleString("es-ES")} kg. Evidencia: A fuerte, B moderada, C limitada.`} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {recommended.map((c) => (
            <CatalogItem key={c.code} personId={pid} item={c} canWrite={ctx.canWrite && !p?.isChild} />
          ))}
        </div>
        {others.length ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-ink-2">Otros con evidencia menor ({others.length})</summary>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              {others.map((c) => (
                <CatalogItem key={c.code} personId={pid} item={c} canWrite={ctx.canWrite && !p?.isChild} />
              ))}
            </div>
          </details>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="No hace falta" subtitle="Productos muy anunciados que no ayudan a ganar músculo" />
        <ul className="space-y-2 text-sm">
          {NOT_NEEDED.map((x) => (
            <li key={x.name}>
              <span className="font-medium">{x.name}:</span> <span className="text-ink-2">{x.why}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export default function SuplementosPage() {
  return (
    <>
      <PageHeader title="Suplementos" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}
