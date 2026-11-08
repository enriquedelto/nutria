import { Suspense } from "react";
import { AlertTriangle, Pencil, Plus } from "lucide-react";
import { and, asc, desc, drugFoodInteractions, eq, gte, inArray, lte, medicationDoses, medications } from "@nutria/db";
import { todayIn } from "@nutria/nutrition";
import { DoseButton } from "@/components/health/dose-button";
import { MedicationActions, MedicationDialog } from "@/components/health/forms";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty, Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { time } from "@/lib/format";
import { requireScope } from "@/lib/session";

export const metadata = { title: "Medicación" };

const FOOD_ES: Record<string, string> = { with: "con comida", without: "en ayunas", any: "" };
const DAYS = ["L", "M", "X", "J", "V", "S", "D"];

async function Content() {
  const ctx = await requireScope("medication");
  const pid = ctx.person.id;
  const tz = ctx.person.timezone;
  const today = todayIn(tz);
  const now = Date.now();
  const meds = await db().select().from(medications).where(eq(medications.personId, pid)).orderBy(desc(medications.active), asc(medications.name));
  const subs = [...new Set(meds.filter((m) => m.active && m.substanceCode).map((m) => m.substanceCode!))];
  const [doses, interactions] = await Promise.all([
    db()
      .select({ id: medicationDoses.id, at: medicationDoses.scheduledAt, status: medicationDoses.status, medicationId: medicationDoses.medicationId })
      .from(medicationDoses)
      .where(and(eq(medicationDoses.personId, pid), gte(medicationDoses.scheduledAt, new Date(now - 7 * 86_400_000)), lte(medicationDoses.scheduledAt, new Date(now + 86_400_000))))
      .orderBy(asc(medicationDoses.scheduledAt)),
    subs.length ? db().select().from(drugFoodInteractions).where(inArray(drugFoodInteractions.substanceCode, subs)) : Promise.resolve([]),
  ]);
  const name = new Map(meds.map((m) => [m.id, m]));
  const localDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  const todayDoses = doses.filter((x) => localDay(x.at) === today);
  const past = doses.filter((x) => x.at.getTime() < now && localDay(x.at) !== today);
  const adherence = past.length ? Math.round((past.filter((x) => x.status === "taken").length / past.length) * 100) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <Card>
          <CardHeader title="Hoy" subtitle={adherence != null ? `Adherencia últimos 7 días: ${adherence} %` : undefined} />
          {todayDoses.length ? (
            <ul className="divide-y divide-line">
              {todayDoses.map((x) => {
                const m = name.get(x.medicationId);
                const late = x.status === "pending" && x.at.getTime() < now - 30 * 60_000;
                return (
                  <li key={x.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className={`num w-12 ${late ? "font-semibold text-persimmon" : "text-ink-3"}`}>{time(x.at, tz)}</span>
                    <span className="flex-1">
                      {m?.name} {m?.dose ? <span className="text-ink-3">· {m.dose}</span> : null}
                      {m?.withFood && m.withFood !== "any" ? <span className="ml-1 text-xs text-ink-3">({FOOD_ES[m.withFood]})</span> : null}
                    </span>
                    <DoseButton personId={pid} doseId={x.id} status={x.status} disabled={!ctx.canWrite} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">No hay tomas programadas hoy.</p>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Medicamentos"
            action={
              ctx.canWrite ? (
                <MedicationDialog
                  personId={pid}
                  trigger={
                    <Button size="sm">
                      <Plus /> Añadir
                    </Button>
                  }
                />
              ) : null
            }
          />
          {meds.length ? (
            <ul className="divide-y divide-line">
              {meds.map((m) => (
                <li key={m.id} className={`flex flex-wrap items-center gap-2 py-3 ${m.active ? "" : "opacity-60"}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {m.name} {m.dose ? <span className="font-normal text-ink-2">· {m.dose}</span> : null} {!m.active ? <Badge>en pausa</Badge> : null}
                    </p>
                    <p className="text-xs text-ink-3">
                      {m.times.join(" · ") || "sin hora"}
                      {m.daysOfWeek.length ? ` · ${m.daysOfWeek.map((d) => DAYS[d - 1]).join("")}` : " · todos los días"}
                      {FOOD_ES[m.withFood ?? "any"] ? ` · ${FOOD_ES[m.withFood ?? "any"]}` : ""}
                      {m.endDate ? ` · hasta ${m.endDate.split("-").reverse().join("/")}` : ""}
                    </p>
                  </div>
                  {ctx.canWrite ? (
                    <>
                      <MedicationDialog
                        personId={pid}
                        med={{ ...m, withFood: m.withFood ?? "any" }}
                        trigger={
                          <Button size="icon-sm" variant="ghost" aria-label="Editar">
                            <Pencil />
                          </Button>
                        }
                      />
                      <MedicationActions personId={pid} id={m.id} active={m.active} />
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Sin medicamentos">Añádelos para recibir avisos y alertas con alimentos.</Empty>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Con los alimentos" subtitle="Tabla curada, no generada por IA" />
        {interactions.length ? (
          <ul className="space-y-2 text-sm">
            {interactions.map((i) => (
              <li key={i.id} className={`flex gap-2 rounded-xl p-2 ${i.severity === "avoid" ? "bg-danger/10" : i.severity === "caution" ? "bg-warn/20" : "bg-paper-2"}`}>
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  <b>{i.substanceNameEs}:</b> {i.messageEs}
                  <span className="mt-0.5 block text-[11px] text-ink-3">Fuente: {i.source}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">No hay interacciones conocidas para tus medicamentos activos. Si indicas el principio activo, la detección es más fiable.</p>
        )}
      </Card>
    </div>
  );
}

export default function MedicacionPage() {
  return (
    <>
      <PageHeader title="Medicación" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}
