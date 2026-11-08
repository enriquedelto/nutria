import { Suspense } from "react";
import Link from "next/link";
import { Activity, Bed, CalendarHeart, FlaskConical, HeartPulse, Pill, Timer, Stethoscope, Sparkles } from "lucide-react";
import { and, conditions, count, cyclePeriods, desc, eq, exerciseLogs, fastingSessions, gte, insights, isNull, labResults, medicationDoses, medications, ne, personConditions, sleepLogs, symptomLogs } from "@nutria/db";
import { addDays, averageCycleLength, cyclePhase, fastingStatus, todayIn } from "@nutria/nutrition";
import { DoseButton } from "@/components/health/dose-button";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { n0, n1, time } from "@/lib/format";
import { getPersonContext } from "@/lib/session";

export const metadata = { title: "Salud" };

const PHASE_ES = { menstrual: "Menstruación", follicular: "Fase folicular", ovulation: "Ovulación", luteal: "Fase lútea" } as const;

function Tile({ href, icon, title, value, hint }: { href: string; icon: React.ReactNode; title: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Link href={href} className="group rounded-2xl border border-line bg-card p-4 transition-shadow hover:shadow-md">
      <div className="flex items-center gap-2 text-sm text-ink-2">
        <span className="text-herb">{icon}</span> {title}
      </div>
      <p className="num mt-2 font-display text-2xl font-semibold">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-3">{hint}</p> : null}
    </Link>
  );
}

async function Content() {
  const ctx = await getPersonContext();
  const pid = ctx.person.id;
  const tz = ctx.person.timezone;
  const today = todayIn(tz);
  const has = (s: Parameters<typeof ctx.scopes.has>[0]) => ctx.scopes.has(s);
  const d = db();
  const dayStart = new Date(`${today}T00:00:00Z`);
  const [doses, [fast], [sleep], periods, [sym], [labsOut], conds, [ex], tips] = await Promise.all([
    has("medication")
      ? d
          .select({ id: medicationDoses.id, at: medicationDoses.scheduledAt, status: medicationDoses.status, name: medications.name, dose: medications.dose })
          .from(medicationDoses)
          .innerJoin(medications, eq(medications.id, medicationDoses.medicationId))
          .where(and(eq(medicationDoses.personId, pid), gte(medicationDoses.scheduledAt, new Date(dayStart.getTime() - 14 * 3_600_000))))
          .orderBy(medicationDoses.scheduledAt)
          .limit(30)
      : Promise.resolve([]),
    has("diary") ? d.select().from(fastingSessions).where(and(eq(fastingSessions.personId, pid), isNull(fastingSessions.endedAt))).limit(1) : Promise.resolve([]),
    has("health") ? d.select().from(sleepLogs).where(eq(sleepLogs.personId, pid)).orderBy(desc(sleepLogs.date)).limit(1) : Promise.resolve([]),
    has("cycle") ? d.select().from(cyclePeriods).where(eq(cyclePeriods.personId, pid)).orderBy(desc(cyclePeriods.startDate)).limit(7) : Promise.resolve([]),
    has("health") ? d.select({ n: count() }).from(symptomLogs).where(and(eq(symptomLogs.personId, pid), gte(symptomLogs.date, addDays(today, -7)))) : Promise.resolve([{ n: 0 }]),
    has("labs") ? d.select({ n: count() }).from(labResults).where(and(eq(labResults.personId, pid), ne(labResults.flag, "normal"), gte(labResults.date, addDays(today, -365)))) : Promise.resolve([{ n: 0 }]),
    has("health")
      ? d.select({ name: conditions.nameEs }).from(personConditions).innerJoin(conditions, eq(conditions.code, personConditions.conditionCode)).where(and(eq(personConditions.personId, pid), eq(personConditions.active, true)))
      : Promise.resolve([]),
    has("body") ? d.select({ n: count() }).from(exerciseLogs).where(and(eq(exerciseLogs.personId, pid), gte(exerciseLogs.date, addDays(today, -6)))) : Promise.resolve([{ n: 0 }]),
    has("health") ? d.select().from(insights).where(and(eq(insights.personId, pid), isNull(insights.dismissedAt))).orderBy(desc(insights.createdAt)).limit(3) : Promise.resolve([]),
  ]);
  const todayDoses = doses.filter((x) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(x.at) === today);
  const fs = fast ? fastingStatus(fast.startedAt, fast.targetHours) : null;
  const cyc = periods[0] ? cyclePhase(periods[0].startDate, today, averageCycleLength(periods.map((p) => p.startDate))) : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {has("medication") ? <Tile href="/salud/medicacion" icon={<Pill className="size-4" />} title="Medicación" value={`${todayDoses.filter((x) => x.status === "taken").length}/${todayDoses.length}`} hint="tomas de hoy" /> : null}
        {has("diary") ? <Tile href="/salud/ayuno" icon={<Timer className="size-4" />} title="Ayuno" value={fs ? `${n1(fs.elapsedH)} h` : "—"} hint={fs ? `${Math.round(fs.pct * 100)} % de ${fast!.targetHours} h` : "Sin ayuno en curso"} /> : null}
        {has("health") ? <Tile href="/salud/sueno" icon={<Bed className="size-4" />} title="Sueño" value={sleep ? `${n1(sleep.hours)} h` : "—"} hint={sleep ? `noche del ${sleep.date.slice(5).split("-").reverse().join("/")}` : "Sin registros"} /> : null}
        {has("cycle") ? <Tile href="/salud/ciclo" icon={<CalendarHeart className="size-4" />} title="Ciclo" value={cyc ? `Día ${cyc.day}` : "—"} hint={cyc ? PHASE_ES[cyc.phase] : "Opcional y privado"} /> : null}
        {has("health") ? <Tile href="/salud/sintomas" icon={<HeartPulse className="size-4" />} title="Síntomas" value={n0(sym?.n ?? 0)} hint="últimos 7 días" /> : null}
        {has("labs") ? <Tile href="/salud/analiticas" icon={<FlaskConical className="size-4" />} title="Analíticas" value={n0(labsOut?.n ?? 0)} hint="valores fuera de rango (1 año)" /> : null}
        {has("body") ? <Tile href="/salud/ejercicio" icon={<Activity className="size-4" />} title="Ejercicio" value={n0(ex?.n ?? 0)} hint="sesiones esta semana" /> : null}
        {has("health") ? <Tile href="/salud/condiciones" icon={<Stethoscope className="size-4" />} title="Condiciones" value={conds.length || "—"} hint={conds.map((c) => c.name).join(", ") || "Ninguna activa"} /> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {todayDoses.length ? (
          <Card>
            <CardHeader title="Tomas de hoy" action={<Link href="/salud/medicacion" className="text-sm text-herb hover:underline">Gestionar</Link>} />
            <ul className="divide-y divide-line">
              {todayDoses.map((x) => (
                <li key={x.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="num w-12 text-ink-3">{time(x.at, tz)}</span>
                  <span className="flex-1">
                    {x.name} {x.dose ? <span className="text-ink-3">· {x.dose}</span> : null}
                  </span>
                  <DoseButton personId={pid} doseId={x.id} status={x.status} disabled={!ctx.canWrite} />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        {tips.length ? (
          <Card>
            <CardHeader title="Descubrimientos" subtitle="Patrones detectados en tus registros" />
            <ul className="space-y-3">
              {tips.map((t) => (
                <li key={t.id} className="rounded-xl bg-paper-2 p-3 text-sm">
                  <p className="flex items-center gap-2 font-medium">
                    <Sparkles className="size-4 text-persimmon" /> {t.title}
                    {t.score != null ? <Badge tone="neutral">fuerza {Math.round(t.score * 100)} %</Badge> : null}
                  </p>
                  <div className="mt-1 text-ink-2">
                    <Markdown text={t.bodyMd} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

export default function SaludPage() {
  return (
    <>
      <PageHeader title="Salud" subtitle="Medicación, síntomas, analíticas, ayuno, sueño y más" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}
