import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { and, asc, desc, eq, lt, mealPlans, mealSlots, recipes } from "@nutria/db";
import { planWeek, targetsForDate } from "@nutria/core";
import { batchSuggestions, dateRange, planCoverage, todayIn, weekStart } from "@nutria/nutrition";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { dateShort, isDate } from "@/lib/format";
import { kitchenContext } from "@/lib/kitchen";
import { PlanBoard } from "./plan-client";

export const metadata = { title: "Planes" };

const FALLBACK_SLOTS = [
  { key: "breakfast", label: "Desayuno" },
  { key: "lunch", label: "Comida" },
  { key: "dinner", label: "Cena" },
];

function shift(d: string, days: number) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
}

async function Content({ searchParams }: { searchParams: PageProps<"/planes">["searchParams"] }) {
  const sp = await searchParams;
  const k = await kitchenContext();
  const today = todayIn(k.person.timezone);
  const week = weekStart(isDate(sp.semana) ? sp.semana : today);
  const days = dateRange(week, shift(week, 6));
  const [current, slots, recipeRows, [prev]] = await Promise.all([
    planWeek(db(), k.groupId, week),
    db().select({ key: mealSlots.key, label: mealSlots.label }).from(mealSlots).where(eq(mealSlots.personId, k.person.id)).orderBy(asc(mealSlots.sortOrder)),
    db().select({ id: recipes.id, title: recipes.title, kcal: recipes.kcalPerServing, protein: recipes.proteinPerServing, fridgeDays: recipes.fridgeDays, freezable: recipes.freezable, prepMin: recipes.prepMin, tags: recipes.tags }).from(recipes).where(eq(recipes.groupId, k.groupId)).orderBy(asc(recipes.title)),
    db().select({ id: mealPlans.id, weekStart: mealPlans.weekStart }).from(mealPlans).where(and(eq(mealPlans.groupId, k.groupId), lt(mealPlans.weekStart, week))).orderBy(desc(mealPlans.weekStart)).limit(1),
  ]);
  const slotList = slots.length ? slots : FALLBACK_SLOTS;
  // Coverage of the active person (if in the plan) against each day's own target, and batch-cooking ideas.
  const byId = new Map(recipeRows.map((r) => [r.id, r]));
  const inPlan = !!current?.plan.personIds.includes(k.person.id);
  const targets = inPlan ? Object.fromEntries(await Promise.all(days.map(async (d) => [d, await targetsForDate(db(), k.person.id, d)] as const))) : {};
  const coverage = inPlan
    ? planCoverage(
        days,
        current!.items.map((i) => {
          const r = i.recipeId ? byId.get(i.recipeId) : undefined;
          return { date: i.date, recipeId: i.recipeId, title: i.title, servings: i.portions[k.person.id]?.servings ?? 0, kcalPerServing: r?.kcal ?? null, proteinPerServing: r?.protein ?? null };
        }),
        targets,
      )
    : [];
  const batches = current
    ? batchSuggestions(
        current.items.filter((i) => !i.cooked).map((i) => ({ recipeId: i.recipeId, title: i.title, date: i.date, servings: Object.values(i.portions).reduce((a, p) => a + p.servings, 0) })),
        Object.fromEntries(recipeRows.map((r) => [r.id, { fridgeDays: r.fridgeDays, freezable: r.freezable }])),
      )
    : [];
  const mainSlots = slotList.filter((s) => ["breakfast", "lunch", "dinner"].includes(s.key));
  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/planes?semana=${shift(week, -7)}`}>
            <ChevronLeft /> Anterior
          </Link>
        </Button>
        <p className="text-center text-sm font-medium">
          {dateShort(week)} – {dateShort(shift(week, 6))}
          {week === weekStart(today) ? <span className="block text-xs text-herb">Esta semana</span> : null}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href={`/planes?semana=${shift(week, 7)}`}>
            Siguiente <ChevronRight />
          </Link>
        </Button>
      </div>
      <PlanBoard
        week={week}
        today={today}
        days={days}
        slots={slotList}
        defaultSlots={(mainSlots.length ? mainSlots : slotList).map((s) => s.key)}
        members={k.members.map((m) => ({ id: m.id, name: m.name, color: m.color, isChild: m.isChild }))}
        currentPersonId={k.person.id}
        canAi={k.scopes.has("ai")}
        timezone={k.person.timezone}
        coverage={coverage}
        coverageName={k.person.name}
        batches={batches}
        prevPlan={prev ? { id: prev.id, label: dateShort(prev.weekStart) } : null}
        recipes={recipeRows.map((r) => ({ id: r.id, title: r.title, kcal: r.kcal, protein: r.protein, prepMin: r.prepMin, tags: r.tags }))}
        plan={
          current
            ? {
                id: current.plan.id,
                personIds: current.plan.personIds,
                items: current.items.map((i) => ({ id: i.id, date: i.date, mealSlot: i.mealSlot, recipeId: i.recipeId, title: i.title, note: i.note, cooked: i.cooked, portions: i.portions })),
              }
            : null
        }
      />
    </>
  );
}

export default function PlanesPage(props: PageProps<"/planes">) {
  return (
    <>
      <PageHeader title="Plan semanal" subtitle="Comidas de la casa, con la ración de cada uno" />
      <Suspense fallback={<Skeleton className="h-[32rem]" />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
