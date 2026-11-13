import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { and, dailySummaries, eq, gte, lte, mealFeelings } from "@nutria/db";
import { addDays, dailyQualityScore, dayLogStatus, NOVA_MIN_COVERAGE, novaCoverage, NUTRIENTS, todayIn, upfKcalPct } from "@nutria/nutrition";
import { MacroSummary } from "@/components/diary/macro-summary";
import { MealCard } from "@/components/diary/meal-card";
import { CaffeineCard } from "@/components/diary/caffeine-card";
import { caffeineDay, trainingDayMeals } from "@nutria/core";
import { TrainingMeals } from "@/components/diary/training-meals";
import { minuteOfDay } from "@/lib/slots";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { Bar } from "@/components/ui/progress";
import { db } from "@/lib/db";
import { getDay } from "@/lib/data/day";
import { isDate, n0, nutrient, relativeDay, weekday } from "@/lib/format";
import { requireScope } from "@/lib/session";
import { cn } from "@/lib/utils";
import { DayActions, FeelingButton } from "./day-actions";

export const metadata = { title: "Diario" };

const CATEGORY_TITLES: Record<string, string> = { macro: "Macronutrientes", carb_detail: "Hidratos", fat_detail: "Grasas", vitamin: "Vitaminas", mineral: "Minerales", other: "Otros" };

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireScope("diary");
  const today = todayIn(ctx.person.timezone);
  const date = isDate(sp.fecha) ? sp.fecha : today;
  const [day, week, feelings, caffeine, mealsAround] = await Promise.all([
    getDay(ctx.person.id, date),
    db().select({ date: dailySummaries.date, kcal: dailySummaries.kcal, complete: dailySummaries.complete, incomplete: dailySummaries.incomplete }).from(dailySummaries).where(and(eq(dailySummaries.personId, ctx.person.id), gte(dailySummaries.date, addDays(date, -6)), lte(dailySummaries.date, addDays(date, 6)))),
    db().select().from(mealFeelings).where(and(eq(mealFeelings.personId, ctx.person.id), eq(mealFeelings.date, date))),
    caffeineDay(db(), ctx.person.id, date),
    trainingDayMeals(db(), ctx.person.id, date),
  ]);
  const byDate = new Map(week.map((w) => [w.date, w]));
  const strip = Array.from({ length: 7 }, (_, i) => addDays(date, i - 3));
  const slots = day.meals.map((m) => ({ key: m.key, label: m.label }));
  const upf = upfKcalPct(day.entries.map((e) => ({ kcal: e.kcal, nova: e.nova })));
  const novaPct = novaCoverage(day.entries.map((e) => ({ kcal: e.kcal, nova: e.nova })));
  const upfPartial = novaPct != null && novaPct < NOVA_MIN_COVERAGE;
  const quality = dailyQualityScore(
    day.entries.map((e) => ({ kcal: e.kcal, nova: e.nova, nutriscore: e.nutriscore })),
    day.totals,
    { kcal: day.target?.kcal ?? 2000, fiber: day.target?.fiber ?? 25, salt: day.microTargets.salt?.max ?? 5, sat_fat: day.microTargets.sat_fat?.max, added_sugars: day.microTargets.added_sugars?.max },
  );
  const complete = byDate.get(date)?.complete ?? false;
  const incomplete = byDate.get(date)?.incomplete ?? false;
  const status = dayLogStatus({ kcal: day.totals.energy_kcal ?? 0, entries: day.entries.length, complete, incomplete }, day.target?.kcal);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Día anterior">
          <Link href={`/diario?fecha=${addDays(date, -1)}`}>
            <ChevronLeft />
          </Link>
        </Button>
        <div className="text-center">
          <h1 className="text-2xl font-semibold sm:text-3xl">{relativeDay(date, today)}</h1>
          {date !== today ? (
            <Link href="/diario" className="text-sm text-herb">
              Ir a hoy
            </Link>
          ) : null}
        </div>
        <Button asChild variant="ghost" size="icon" aria-label="Día siguiente">
          <Link href={`/diario?fecha=${addDays(date, 1)}`}>
            <ChevronRight />
          </Link>
        </Button>
      </div>

      <nav aria-label="Semana" className="mb-5 grid grid-cols-7 gap-1">
        {strip.map((d) => {
          const s = byDate.get(d);
          const pctOfTarget = s && day.target ? s.kcal / day.target.kcal : 0;
          return (
            <Link key={d} href={`/diario?fecha=${d}`} className={cn("flex flex-col items-center gap-1 rounded-xl py-2 text-xs", d === date ? "bg-herb text-herb-ink" : "hover:bg-paper-2")} aria-current={d === date ? "date" : undefined}>
              <span className="capitalize">{weekday(d)}</span>
              <span className="num font-semibold">{d.slice(8)}</span>
              <span className={cn("h-1 w-6 rounded-full", d === date ? "bg-herb-ink/40" : "bg-paper-2")}>
                <span className={cn("block h-full rounded-full", d === date ? "bg-herb-ink" : pctOfTarget > 1.05 ? "bg-persimmon" : "bg-herb")} style={{ width: `${Math.min(100, pctOfTarget * 100)}%` }} />
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <Card>
            <MacroSummary totals={day.totals} target={day.target} exerciseKcal={day.exerciseKcal} unit={day.energyUnit} />
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
              {quality != null ? <Badge tone={quality >= 70 ? "ok" : quality >= 45 ? "warn" : "danger"}>Calidad {quality}/100</Badge> : null}
              {upf != null ? (
                <Badge tone={upf > 30 && !upfPartial ? "accent" : "neutral"}>
                  {n0(upf)} % kcal ultraprocesadas{upfPartial ? ` · dato en ${n0(novaPct!)} % de las kcal` : ""}
                </Badge>
              ) : null}
              {complete ? <Badge tone="herb">Día completo</Badge> : null}
              {incomplete ? <Badge tone="neutral">Día incompleto · fuera de las medias</Badge> : null}
            </div>
          </Card>
          {day.meals.map((m) => (
            <div key={m.key} className="space-y-1">
              <MealCard personId={ctx.person.id} date={date} slot={m.key} label={m.label} entries={m.entries} slots={slots} canWrite={ctx.canWrite} proteinDose={m.main ? day.proteinDose : null} microTargets={day.microTargets} slotTime={m.time} timeZone={ctx.person.timezone} />
              {m.entries.length && ctx.canWrite ? <FeelingButton personId={ctx.person.id} date={date} slot={m.key} current={feelings.find((f) => f.mealSlot === m.key) ?? null} /> : null}
            </div>
          ))}
          {status === "suspect" && date < today ? (
            <p className="rounded-xl bg-paper-2 px-4 py-3 text-sm text-ink-2">
              Este día tiene {n0(day.totals.energy_kcal ?? 0)} kcal, menos de la mitad de tu objetivo, así que no cuenta en las medias ni en el informe. Si de verdad comiste eso, márcalo como completo; si no, añade lo que falta o márcalo como incompleto.
            </p>
          ) : null}
          {ctx.canWrite ? <DayActions personId={ctx.person.id} date={date} today={today} complete={complete} incomplete={incomplete} hasEntries={day.entries.length > 0} meals={day.meals.filter((m) => m.entries.length).map((m) => ({ key: m.key, label: m.label, items: m.entries.map((e) => ({ foodId: e.foodId ?? undefined, name: e.name, grams: e.grams, servingLabel: e.servingLabel ?? undefined })) }))} /> : null}
        </div>

        <div className="min-w-0 space-y-4">
        {mealsAround.session && mealsAround.weightKg ? (
          <Card>
            <CardHeader title="Comida y entreno" subtitle={`${mealsAround.session.name ?? "Entreno"} · ${mealsAround.session.source === "logged" ? "registrado" : "hora habitual"}`} action={<Link href="/salud/ejercicio#comida-entreno" className="text-xs text-herb underline">Tu mejor momento</Link>} />
            <TrainingMeals session={mealsAround.session} meals={mealsAround.meals} weightKg={mealsAround.weightKg} nowMin={date === today ? minuteOfDay(ctx.person.timezone) : null} />
          </Card>
        ) : null}
        {caffeine.doses.length || caffeine.trainingStart != null ? (
          <CaffeineCard key={`${caffeine.bedtime}-${caffeine.halfLifeH}`} personId={ctx.person.id} day={caffeine} canEdit={ctx.canWrite} />
        ) : null}
        <Card id="nutrientes" className="h-fit lg:sticky lg:top-20">
          <CardHeader title="Nutrientes" subtitle="Total del día frente a tus objetivos" action={<Link href="/informe" className="text-xs text-herb underline">Informe</Link>} />
          {Object.entries(CATEGORY_TITLES).map(([cat, title]) => {
            const list = NUTRIENTS.filter((n) => n.category === cat);
            return (
              <details key={cat} open={cat === "vitamin" || cat === "mineral" || cat === "macro"} className="border-t border-line py-2 first-of-type:border-t-0">
                <summary className="cursor-pointer py-1 text-sm font-semibold">{title}</summary>
                <ul className="mt-2 space-y-2">
                  {list.map((n) => {
                    const v = day.totals[n.code] ?? 0;
                    const t = day.microTargets[n.code];
                    const goal = t?.min ?? (n.code === "fiber" ? day.target?.fiber : undefined) ?? null;
                    const over = t?.max != null && v > t.max;
                    return (
                      <li key={n.code} className="text-sm">
                        <div className="flex justify-between gap-2">
                          <span className="truncate">{n.nameEs}</span>
                          <span className={cn("num shrink-0", over ? "text-danger" : "text-ink-2")}>
                            {nutrient(n.code, v)}
                            {goal ? <span className="text-ink-3"> / {nutrient(n.code, goal)}</span> : t?.max ? <span className="text-ink-3"> (máx. {nutrient(n.code, t.max)})</span> : null}
                          </span>
                        </div>
                        {goal || t?.max ? <Bar className="mt-1 h-1.5" value={v} max={goal ?? t?.max} color={over ? "var(--danger)" : "var(--herb)"} label={n.nameEs} /> : null}
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
          <p className="mt-2 text-xs text-ink-3">Referencias EFSA según edad y sexo. Los alimentos sin datos de un nutriente cuentan como 0.</p>
        </Card>
        </div>
      </div>
    </>
  );
}

export default function DiarioPage({ searchParams }: PageProps<"/diario">) {
  return (
    <Suspense fallback={<Skeleton className="h-[32rem]" />}>
      <Content searchParams={searchParams as Promise<Record<string, string | undefined>>} />
    </Suspense>
  );
}
