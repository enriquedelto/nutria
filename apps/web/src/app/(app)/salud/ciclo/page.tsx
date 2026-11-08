import { Suspense } from "react";
import { Lock } from "lucide-react";
import { and, cyclePeriods, cycleSymptoms, desc, eq, gte } from "@nutria/db";
import { addDays, averageCycleLength, CYCLE_PHASE_NOTES, cyclePhase, todayIn, type CyclePhase } from "@nutria/nutrition";
import { CycleSymptoms, PeriodControls } from "@/components/health/forms";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { dateLong, dateShort, relativeDay } from "@/lib/format";
import { requireScope } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata = { title: "Ciclo" };

const PHASE: Record<CyclePhase, { name: string; cls: string }> = {
  menstrual: { name: "Menstruación", cls: "bg-persimmon text-white" },
  follicular: { name: "Folicular", cls: "bg-herb-soft text-herb" },
  ovulation: { name: "Ovulación", cls: "bg-herb text-herb-ink" },
  luteal: { name: "Lútea", cls: "bg-paper-2 text-ink-2" },
};
const SYM: Record<string, string> = { cramps: "Dolor", bloating: "Hinchazón", cravings: "Antojos", fatigue: "Cansancio", mood: "Ánimo bajo", headache: "Dolor de cabeza", acne: "Acné", breast: "Pecho sensible" };

async function Content() {
  const ctx = await requireScope("cycle");
  const pid = ctx.person.id;
  const today = todayIn(ctx.person.timezone);
  const [periods, syms] = await Promise.all([
    db().select().from(cyclePeriods).where(eq(cyclePeriods.personId, pid)).orderBy(desc(cyclePeriods.startDate)).limit(12),
    db().select().from(cycleSymptoms).where(and(eq(cycleSymptoms.personId, pid), gte(cycleSymptoms.date, addDays(today, -60)))).orderBy(desc(cycleSymptoms.date)),
  ]);
  const len = averageCycleLength(periods.map((p) => p.startDate));
  const last = periods[0];
  const periodLen = (() => {
    const ls = periods.filter((p) => p.endDate).map((p) => (Date.parse(p.endDate!) - Date.parse(p.startDate)) / 86_400_000 + 1);
    return ls.length ? Math.round(ls.reduce((a, b) => a + b, 0) / ls.length) : 5;
  })();
  const now = last ? cyclePhase(last.startDate, today, len, periodLen) : null;
  const open = last && !last.endDate ? { id: last.id, startDate: last.startDate } : null;
  const strip = last ? Array.from({ length: 35 }, (_, i) => addDays(today, i - 3)).map((d) => ({ d, ...cyclePhase(last.startDate, d, len, periodLen) })) : [];
  const todaySyms = syms.filter((s) => s.date === today);

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-ink-2">
        <Lock className="size-4" /> Privado: solo tú lo ves, salvo que des permiso de «ciclo» a alguien en Familia.
      </p>
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Card>
          {now ? (
            <>
              <CardHeader title={`Día ${now.day} · ${PHASE[now.phase].name}`} subtitle={`Ciclo medio ${len} días · próxima regla hacia el ${dateLong(now.nextStart)}`} />
              <p className="rounded-xl bg-paper-2 p-3 text-sm">{CYCLE_PHASE_NOTES[now.phase]}</p>
              <div className="mt-4 overflow-x-auto">
                <ol className="flex w-max gap-1">
                  {strip.map((s) => (
                    <li key={s.d} title={`${dateShort(s.d)} · ${PHASE[s.phase].name}`} className={cn("grid h-12 w-8 place-items-center rounded-lg text-[11px]", PHASE[s.phase].cls, s.d === today && "ring-2 ring-ink")}>
                      <span className="num">{Number(s.d.slice(8))}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <ul className="mt-2 flex flex-wrap gap-3 text-xs text-ink-3">
                {Object.entries(PHASE).map(([k, v]) => (
                  <li key={k} className="flex items-center gap-1">
                    <span className={cn("size-3 rounded", v.cls)} /> {v.name}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-3">Estimación por calendario; no sirve como método anticonceptivo.</p>
            </>
          ) : (
            <CardHeader title="Empieza registrando tu última regla" subtitle="Con dos o tres ciclos la predicción se ajusta a ti" />
          )}
          {ctx.canWrite ? (
            <div className="mt-4 border-t border-line pt-4">
              <PeriodControls personId={pid} today={today} open={open} />
            </div>
          ) : null}
        </Card>
        <div className="space-y-4">
          {ctx.canWrite ? (
            <Card>
              <CardHeader title="¿Cómo estás hoy?" subtitle={todaySyms.length ? todaySyms.map((s) => SYM[s.symptom] ?? s.symptom).join(", ") : undefined} />
              <CycleSymptoms personId={pid} today={today} />
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Historial" />
            <ul className="divide-y divide-line text-sm">
              {periods.map((p, i) => (
                <li key={p.id} className="flex justify-between py-1.5">
                  <span>
                    {dateShort(p.startDate)}
                    {p.endDate ? ` – ${dateShort(p.endDate)}` : " (en curso)"}
                  </span>
                  <span className="num text-ink-3">{periods[i + 1] ? `${Math.round((Date.parse(p.startDate) - Date.parse(periods[i + 1]!.startDate)) / 86_400_000)} días` : ""}</span>
                </li>
              ))}
            </ul>
            {syms.length ? (
              <p className="mt-3 text-xs text-ink-3">
                Síntomas recientes: {syms.slice(0, 8).map((s) => `${SYM[s.symptom] ?? s.symptom} (${relativeDay(s.date, today).toLowerCase()})`).join(", ")}
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function CicloPage() {
  return (
    <>
      <PageHeader title="Ciclo menstrual" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}
