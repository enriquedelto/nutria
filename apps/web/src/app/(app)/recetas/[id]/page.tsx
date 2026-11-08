import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, ExternalLink, Pencil, Snowflake } from "lucide-react";
import { and, asc, batches, eq, foodServings, gt, inArray, mealSlots, recipeRatings } from "@nutria/db";
import { ensureMealSlots, recipeDetail } from "@nutria/core";
import { CORE_MICROS, todayIn } from "@nutria/nutrition";
import { CookDialog, CookModeLink, DeleteRecipe, LogRecipe, Rating, ScaledIngredients, Substitutions } from "@/components/kitchen/recipe-actions";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { n0, nutrient, nutrientName } from "@/lib/format";
import { kitchenContext } from "@/lib/kitchen";
import { closestSlot } from "@/lib/slots";

async function Content({ params }: { params: PageProps<"/recetas/[id]">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const k = await kitchenContext();
  const d = await recipeDetail(db(), id, k.groupId);
  if (!d) notFound();
  const r = d.recipe;
  await ensureMealSlots(db(), k.person.id);
  const [slots, ratings, serving, [batch]] = await Promise.all([
    db().select().from(mealSlots).where(eq(mealSlots.personId, k.person.id)).orderBy(asc(mealSlots.sortOrder)),
    db().select().from(recipeRatings).where(and(eq(recipeRatings.recipeId, r.id), inArray(recipeRatings.personId, k.members.map((m) => m.id).concat(k.person.id)))),
    r.foodId ? db().select().from(foodServings).where(and(eq(foodServings.foodId, r.foodId), eq(foodServings.isDefault, true))).limit(1) : Promise.resolve([]),
    db().select({ id: batches.id, left: batches.portionsLeft }).from(batches).where(and(eq(batches.recipeId, r.id), eq(batches.groupId, k.groupId), gt(batches.portionsLeft, 0))).orderBy(asc(batches.cookedOn)).limit(1),
  ]);
  const mine = ratings.filter((x) => x.personId === k.person.id).at(-1);
  const avg = ratings.filter((x) => x.stars).reduce((a, x, _, arr) => a + x.stars! / arr.length, 0);
  const micros = CORE_MICROS.filter((c) => (r.nutrientsPerServing[c] ?? 0) > 0);
  const tz = k.person.timezone;
  const today = todayIn(tz);

  return (
    <>
      <PageHeader
        title={r.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {r.prepMin || r.cookMin ? (
              <span className="flex items-center gap-1">
                <Clock className="size-4" /> {r.prepMin ? `${r.prepMin} min prep.` : ""} {r.cookMin ? `${r.cookMin} min cocción` : ""}
              </span>
            ) : null}
            {r.freezable ? (
              <span className="flex items-center gap-1">
                <Snowflake className="size-4" /> congelable
              </span>
            ) : null}
            {avg ? <span>★ {avg.toFixed(1)} ({ratings.filter((x) => x.stars).length})</span> : null}
            {r.sourceUrl ? (
              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-herb hover:underline">
                <ExternalLink className="size-4" /> {new URL(r.sourceUrl).hostname.replace(/^www\./, "")}
              </a>
            ) : null}
          </span>
        }
        actions={
          <>
            <CookModeLink id={r.id} />
            {r.foodId && k.canWrite && k.scopes.has("diary") ? <LogRecipe personId={k.person.id} foodId={r.foodId} servingGrams={serving[0]?.grams ?? null} title={r.title} slots={slots.map((s) => ({ key: s.key, label: s.label }))} defaultSlot={closestSlot(slots.map((s) => ({ key: s.key, time: s.defaultTime })), tz)} today={today} batch={batch ?? null} /> : null}
            <CookDialog recipeId={r.id} servings={r.servings} freezable={r.freezable} timezone={tz} />
            <Button asChild variant="ghost" size="icon-sm" aria-label="Editar">
              <Link href={`/recetas/${r.id}/editar`}>
                <Pencil />
              </Link>
            </Button>
            <DeleteRecipe id={r.id} />
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {r.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.imageUrl} alt="" referrerPolicy="no-referrer" className="aspect-[16/7] w-full rounded-2xl object-cover" />
          ) : null}
          {r.description ? <p className="text-ink-2">{r.description}</p> : null}
          <div className="grid gap-4 md:grid-cols-[minmax(0,20rem)_1fr]">
            <Card>
              <CardHeader title="Ingredientes" />
              <ScaledIngredients ingredients={d.ingredients} baseServings={r.servings} />
            </Card>
            <Card>
              <CardHeader title="Preparación" />
              {d.steps.length ? (
                <ol className="space-y-3">
                  {d.steps.map((s, i) => (
                    <li key={s.id} className="flex gap-3">
                      <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-herb-soft text-sm font-semibold text-herb">{i + 1}</span>
                      <p className="pt-0.5 leading-relaxed">{s.text}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-ink-3">Sin pasos.</p>
              )}
            </Card>
          </div>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Por ración" subtitle={serving[0] ? `≈ ${n0(serving[0].grams)} g` : undefined} />
            <dl className="grid grid-cols-4 gap-1 text-center">
              {[
                ["kcal", r.kcalPerServing, ""],
                ["Prot.", r.proteinPerServing, " g"],
                ["Hidr.", r.carbsPerServing, " g"],
                ["Grasa", r.fatPerServing, " g"],
              ].map(([k2, v, u]) => (
                <div key={k2 as string} className="rounded-xl bg-paper-2 p-2">
                  <dt className="text-[11px] text-ink-3">{k2 as string}</dt>
                  <dd className="num font-semibold">
                    {n0(v as number | null)}
                    {u as string}
                  </dd>
                </div>
              ))}
            </dl>
            {micros.length ? (
              <ul className="mt-3 space-y-0.5 text-sm">
                {micros.map((c) => (
                  <li key={c} className="flex justify-between">
                    <span className="text-ink-2">{nutrientName(c)}</span>
                    <span className="num">{nutrient(c, r.nutrientsPerServing[c]!)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {r.costPerServing ? <p className="mt-3 text-sm">Coste: <b className="num">{Number(r.costPerServing).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</b> por ración</p> : null}
            {r.tags.length ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {r.tags.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
            ) : null}
          </Card>
          <Card>
            <CardHeader title={`Tu valoración (${k.person.name})`} />
            <Rating personId={k.person.id} recipeId={r.id} current={mine?.stars ?? null} />
            {ratings.length > 1 ? (
              <ul className="mt-3 space-y-0.5 text-sm text-ink-2">
                {ratings
                  .filter((x) => x.personId !== k.person.id)
                  .map((x) => (
                    <li key={x.id}>
                      {k.members.find((m) => m.id === x.personId)?.name ?? "Alguien"}: {x.stars ? "★".repeat(x.stars) : x.verdict === "dislike" ? "👎" : x.verdict === "like" ? "👍" : "—"}
                      {x.notEaten ? " · no se lo comió" : ""}
                    </li>
                  ))}
              </ul>
            ) : null}
          </Card>
          {k.scopes.has("ai") ? (
            <Card>
              <CardHeader title="Sustituciones" subtitle="Ideas de la IA para adaptar la receta" />
              <Substitutions personId={k.person.id} recipeId={r.id} />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

export default function RecetaPage(props: PageProps<"/recetas/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Content params={props.params} />
    </Suspense>
  );
}
