import { Suspense } from "react";
import { todayIn } from "@nutria/nutrition";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/empty";
import { getDay } from "@/lib/data/day";
import { quickLists } from "@/lib/data/foods";
import { dateLong, isDate } from "@/lib/format";
import { closestSlot } from "@/lib/slots";
import { requireScope } from "@/lib/session";
import { eq, persons } from "@nutria/db";
import { listTemplates } from "@nutria/core";
import { db } from "@/lib/db";
import { SearchClient } from "./search-client";

export const metadata = { title: "Buscar" };

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireScope("diary");
  const date = isDate(sp.fecha) ? sp.fecha : todayIn(ctx.person.timezone);
  const [day, lists, [allergy], templates] = await Promise.all([getDay(ctx.person.id, date), quickLists(ctx.person.id), db().select({ allergens: persons.allergens }).from(persons).where(eq(persons.id, ctx.person.id)).limit(1), listTemplates(db(), ctx.person.id)]);
  const slots = day.meals.filter((m) => m.key !== "other").map((m) => ({ key: m.key, label: m.label }));
  const wanted = sp.comida ?? closestSlot(day.meals, ctx.person.timezone);
  const slot = slots.some((s) => s.key === wanted) ? wanted : (slots[0]?.key ?? "lunch");
  return (
    <>
      <PageHeader title="Buscar" subtitle={<span className="inline-block first-letter:uppercase">{dateLong(date)} · {slots.find((s) => s.key === slot)?.label}</span>} />
      <SearchClient
        ctx={{
          personId: ctx.person.id,
          date,
          slot,
          slots,
          totals: { kcal: day.totals.energy_kcal ?? 0, protein: day.totals.protein ?? 0, carbs: day.totals.carbs ?? 0, fat: day.totals.fat ?? 0 },
          target: day.target ? { kcal: day.target.kcal, protein: day.target.protein, carbs: day.target.carbs, fat: day.target.fat } : null,
          favoriteIds: lists.favoriteIds,
        }}
        lists={lists}
        templates={templates.map((t) => ({ id: t.id, name: t.name, mealSlot: t.mealSlot, useCount: t.useCount, items: t.items.map((i) => ({ name: i.name, grams: i.grams })) }))}
        canWrite={ctx.canWrite}
        hasAllergens={(allergy?.allergens.length ?? 0) > 0}
      />
    </>
  );
}

export default function BuscarPage({ searchParams }: PageProps<"/buscar">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Content searchParams={searchParams as Promise<Record<string, string | undefined>>} />
    </Suspense>
  );
}
