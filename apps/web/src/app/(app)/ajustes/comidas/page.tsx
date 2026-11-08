import { Suspense } from "react";
import { asc, eq, mealSlots } from "@nutria/db";
import { ensureMealSlots } from "@nutria/core";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { requireScope } from "@/lib/session";
import { MealSlotsEditor } from "../settings-client";

export const metadata = { title: "Comidas" };

async function Content() {
  const ctx = await requireScope("diary");
  await ensureMealSlots(db(), ctx.person.id);
  const slots = await db().select().from(mealSlots).where(eq(mealSlots.personId, ctx.person.id)).orderBy(asc(mealSlots.sortOrder));
  const canEdit = ctx.person.role === "owner" || ctx.person.role === "manager";
  return (
    <Card>
      {canEdit ? (
        <MealSlotsEditor personId={ctx.person.id} initial={slots.map((s) => ({ key: s.key, label: s.label, defaultTime: s.defaultTime, kcalShare: s.kcalShare }))} />
      ) : (
        <ul className="text-sm">
          {slots.map((s) => (
            <li key={s.id}>
              {s.label} {s.defaultTime?.slice(0, 5)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function ComidasPage() {
  return (
    <>
      <PageHeader title="Comidas del día" subtitle="Nombre, hora habitual y reparto de calorías de cada comida" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}
