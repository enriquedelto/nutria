import { Suspense } from "react";
import Link from "next/link";
import { Flame, Pill, Scale, Timer, Dumbbell, Footprints, FlaskConical } from "lucide-react";
import { fastingStatus, todayIn } from "@nutria/nutrition";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { MacroSummary, MicroList } from "@/components/diary/macro-summary";
import { MealCard } from "@/components/diary/meal-card";
import { WaterCard } from "@/components/diary/water-card";
import { Sparkline } from "@/components/charts/sparkline";
import { DoseButton } from "@/components/health/dose-button";
import { SupplementButton } from "@/components/health/supplement-button";
import { HOME_CARDS } from "@/lib/home-cards";
import { getDay, getHomeExtras } from "@/lib/data/day";
import { getPersonContext } from "@/lib/session";
import { dateLong, kg, n0, n1, time } from "@/lib/format";

export const metadata = { title: "Hoy" };


async function Today() {
  const ctx = await getPersonContext();
  const date = todayIn(ctx.person.timezone);
  const [day, extras] = await Promise.all([getDay(ctx.person.id, date), getHomeExtras(ctx.person.id, ctx.person.timezone, ctx.scopes)]);
  const cards = (day.person.settings.homeCards?.length ? day.person.settings.homeCards : HOME_CARDS) as string[];
  const slots = day.meals.map((m) => ({ key: m.key, label: m.label }));

  const blocks: Record<string, React.ReactNode> = {
    calorias: (
      <Card key="calorias" className="sm:col-span-2">
        <MacroSummary totals={day.totals} target={day.target} exerciseKcal={day.exerciseKcal} unit={day.energyUnit} />
        {!day.target ? (
          <p className="mt-3 text-sm text-ink-2">
            Completa tu <Link className="text-herb underline" href="/ajustes">perfil</Link> para calcular objetivos.
          </p>
        ) : null}
      </Card>
    ),
    comidas: (
      <div key="comidas" className="space-y-3 sm:col-span-2">
        {day.meals.map((m) => (
          <MealCard key={m.key} personId={ctx.person.id} date={date} slot={m.key} label={m.label} entries={m.entries} slots={slots} canWrite={ctx.canWrite} />
        ))}
      </div>
    ),
    agua: (
      <Card key="agua">
        <CardHeader title="Agua" />
        <WaterCard personId={ctx.person.id} date={date} ml={day.waterMl} goal={day.waterGoalMl} canWrite={ctx.canWrite} />
      </Card>
    ),
    micros: (
      <Card key="micros">
        <CardHeader title="Micronutrientes" action={<Link href={`/diario?fecha=${date}#nutrientes`} className="text-sm text-herb">Todos</Link>} />
        <MicroList totals={day.totals} codes={day.trackedMicros.slice(0, 6)} targets={day.microTargets} />
      </Card>
    ),
    peso: ctx.scopes.has("body") ? (
      <Card key="peso">
        <CardHeader title="Peso" action={<Link href="/progreso" className="text-sm text-herb">Progreso</Link>} />
        {extras.weights.length ? (
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="num font-display text-3xl font-semibold">{kg(extras.weights.at(-1)!.kg)}</p>
              <p className="text-xs text-ink-3">{extras.weights.length > 1 ? `${n1(extras.weights.at(-1)!.kg - extras.weights[0]!.kg)} kg en ${extras.weights.length} registros` : "Primer registro"}</p>
            </div>
            <Sparkline values={extras.weights.map((w) => w.kg)} className="h-12 w-32" />
          </div>
        ) : (
          <EmptyLine icon={<Scale />} text="Sin pesajes todavía" href="/progreso" cta="Registrar peso" />
        )}
      </Card>
    ) : null,
    racha: (
      <Card key="racha" className="flex items-center gap-4">
        <span className="grid size-12 place-items-center rounded-full bg-persimmon-soft text-persimmon">
          <Flame className="size-6" />
        </span>
        <div>
          <p className="num font-display text-2xl font-semibold">{extras.streak?.current ?? 0} {extras.streak?.current === 1 ? "día" : "días"}</p>
          <p className="text-sm text-ink-2">registrando seguido · mejor: {extras.streak?.best ?? 0}</p>
        </div>
      </Card>
    ),
    ayuno: extras.fasting ? (
      <Card key="ayuno">
        <CardHeader title="Ayuno en curso" action={<Link href="/salud/ayuno" className="text-sm text-herb">Ver</Link>} />
        <FastingLine startedAt={extras.fasting.startedAt} targetHours={extras.fasting.targetHours} />
      </Card>
    ) : null,
    medicacion:
      extras.meds.length > 0 ? (
        <Card key="medicacion">
          <CardHeader title="Medicación de hoy" action={<Link href="/salud/medicacion" className="text-sm text-herb">Gestionar</Link>} />
          <ul className="space-y-2">
            {extras.meds.map((m) => (
              <li key={m.id} className="flex items-center gap-3">
                <Pill className="size-4 text-ink-3" />
                <span className="flex-1 text-sm">
                  <span className="font-medium">{m.name}</span> {m.dose ? <span className="text-ink-3">· {m.dose}</span> : null}
                  <span className="block text-xs text-ink-3">{time(m.scheduledAt, ctx.person.timezone)}{m.withFood ? " · con comida" : ""}</span>
                </span>
                <DoseButton personId={ctx.person.id} doseId={m.id} status={m.status} disabled={!ctx.canWrite} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null,
    suplementos:
      extras.supplements.length > 0 ? (
        <Card key="suplementos">
          <CardHeader title="Suplementos" action={<Link href="/salud/suplementos" className="text-sm text-herb">Gestionar</Link>} />
          <ul className="space-y-2">
            {extras.supplements.map((s) => (
              <li key={s.id} className="flex items-center gap-3">
                <FlaskConical className="size-4 text-ink-3" />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{s.name}</span> <span className="text-ink-3">· {s.doseLabel}</span>
                  <span className="block text-xs text-ink-3">
                    {s.times.length ? s.times.join(", ") : "sin hora"}
                    {s.streak > 1 ? ` · ${s.streak} días seguidos` : ""}
                  </span>
                </span>
                <SupplementButton personId={ctx.person.id} scheduleId={s.id} date={date} taken={s.taken} name={s.name} disabled={!ctx.canWrite} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null,
    actividad:
      day.exerciseCount || day.steps ? (
        <Card key="actividad" className="flex flex-wrap items-center gap-6">
          {day.exerciseCount ? (
            <Link href="/salud/ejercicio" className="flex min-w-0 items-center gap-3 rounded-xl hover:bg-paper-2">
              <Dumbbell className="size-5 shrink-0 text-ink-3" />
              <div className="min-w-0">
                <p className="num font-semibold">{n0(day.exerciseKcal)} kcal</p>
                <p className="truncate text-xs text-ink-3">
                  {day.exerciseNames.length ? day.exerciseNames.join(" + ") : `${day.exerciseCount} ${day.exerciseCount === 1 ? "sesión" : "sesiones"}`} · {n0(day.exerciseMin)} min
                </p>
              </div>
            </Link>
          ) : null}
          {day.steps ? (
            <div className="flex items-center gap-3">
              <Footprints className="size-5 text-ink-3" />
              <div>
                <p className="num font-semibold">{n0(day.steps.steps)} pasos</p>
                <p className="text-xs text-ink-3">{n0(day.steps.kcal)} kcal</p>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null,
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink-2 first-letter:uppercase">{dateLong(date)}</p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            {ctx.person.isSelf ? `Hola, ${ctx.user.name.split(" ")[0]}` : `Hoy de ${ctx.person.name}`}
          </h1>
        </div>
        {!ctx.canWrite ? <Badge tone="warn">Solo lectura</Badge> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{cards.map((c) => blocks[c] ?? null)}</div>
    </>
  );
}

function FastingLine({ startedAt, targetHours }: { startedAt: Date; targetHours: number }) {
  const s = fastingStatus(startedAt, targetHours);
  return (
    <div className="flex items-center gap-3">
      <Timer className="size-5 text-herb" />
      <div className="flex-1">
        <p className="num font-semibold">
          {n1(s.elapsedH)} h de {targetHours} h
        </p>
        <div className="mt-1 h-2 rounded-full bg-paper-2">
          <div className="h-full rounded-full bg-herb" style={{ width: `${Math.min(100, s.pct * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

function EmptyLine({ icon, text, href, cta }: { icon: React.ReactNode; text: string; href: string; cta: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-ink-2 [&_svg]:size-5">
      {icon}
      <span className="flex-1">{text}</span>
      <Link href={href} className="font-medium text-herb">
        {cta}
      </Link>
    </div>
  );
}

export default function HoyPage() {
  return (
    <Suspense
      fallback={
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-10 w-60 sm:col-span-2" />
          <Skeleton className="h-48 sm:col-span-2" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      }
    >
      <Today />
    </Suspense>
  );
}
