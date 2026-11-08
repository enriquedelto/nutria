import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { and, asc, eq, groups, mealPlanItems, mealPlans, planRetros } from "@nutria/db";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { dateShort } from "@/lib/format";
import { kitchenContext } from "@/lib/kitchen";
import { RetroClient } from "./retro-client";

export const metadata = { title: "Repaso de la semana" };

async function Content({ params }: { params: PageProps<"/planes/[id]/repaso">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const k = await kitchenContext();
  const [plan] = await db().select().from(mealPlans).where(and(eq(mealPlans.id, id), eq(mealPlans.groupId, k.groupId))).limit(1);
  if (!plan) notFound();
  const [items, retros, [g]] = await Promise.all([
    db().select().from(mealPlanItems).where(eq(mealPlanItems.planId, plan.id)).orderBy(asc(mealPlanItems.date), asc(mealPlanItems.sortOrder)),
    db().select().from(planRetros).where(eq(planRetros.planId, plan.id)),
    db().select({ md: groups.preferencesMd }).from(groups).where(eq(groups.id, k.groupId)),
  ]);
  const people = k.members.filter((m) => plan.personIds.includes(m.id));
  return (
    <>
      <div className="no-print mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/planes?semana=${plan.weekStart}`}>
            <ChevronLeft /> Semana del {dateShort(plan.weekStart)}
          </Link>
        </Button>
      </div>
      <RetroClient
        planId={plan.id}
        done={plan.status === "done"}
        canAi={k.scopes.has("ai")}
        householdMd={g?.md ?? ""}
        people={people.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
        defaultPersonId={people.some((p) => p.id === k.person.id) ? k.person.id : (people[0]?.id ?? k.person.id)}
        items={items.map((i) => ({ id: i.id, date: i.date, title: i.title, recipeId: i.recipeId, cooked: i.cooked, eaters: Object.keys(i.portions) }))}
        answers={Object.fromEntries(
          retros.filter((r) => r.personId).map((r) => {
            const a = r.answers as { items?: Record<string, { verdict?: "like" | "dislike" | "neutral"; notEaten?: boolean; stars?: number }>; comment?: string };
            return [r.personId!, { items: a.items ?? {}, comment: a.comment ?? "" }];
          }),
        )}
      />
    </>
  );
}

export default function RepasoPage(props: PageProps<"/planes/[id]/repaso">) {
  return (
    <>
      <PageHeader title="Repaso de la semana" subtitle="Qué gustó y qué no: el planificador aprende de esto" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content params={props.params} />
      </Suspense>
    </>
  );
}
