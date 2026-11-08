import { Suspense } from "react";
import Link from "next/link";
import { ChefHat, Clock, Download, Plus, Star } from "lucide-react";
import { and, desc, eq, ilike, or, recipeRatings, recipes, sql } from "@nutria/db";
import { rowsOf } from "@nutria/core";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, Skeleton } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db";
import { n0 } from "@/lib/format";
import { kitchenContext } from "@/lib/kitchen";

export const metadata = { title: "Recetas" };

async function List({ searchParams }: { searchParams: PageProps<"/recetas">["searchParams"] }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const tag = typeof sp.etiqueta === "string" ? sp.etiqueta : "";
  const k = await kitchenContext();
  const conds = [eq(recipes.groupId, k.groupId)];
  if (q) conds.push(or(ilike(recipes.title, `%${q}%`), sql`${q} = any(${recipes.tags})`)!);
  if (tag) conds.push(sql`${tag} = any(${recipes.tags})`);
  const [rows, tags] = await Promise.all([
    db()
      .select({
        r: recipes,
        stars: sql<number | null>`(select avg(${recipeRatings.stars})::float from ${recipeRatings} where ${recipeRatings.recipeId} = ${recipes.id})`,
        n: sql<number>`(select count(*)::int from ${recipeRatings} where ${recipeRatings.recipeId} = ${recipes.id})`,
      })
      .from(recipes)
      .where(and(...conds))
      .orderBy(desc(recipes.updatedAt))
      .limit(120),
    db().execute(sql`select t, count(*)::int n from ${recipes}, unnest(${recipes.tags}) t where ${recipes.groupId} = ${k.groupId} group by t order by n desc limit 20`),
  ]);
  const tagList = rowsOf<{ t: string }>(tags).map((x) => x.t);
  return (
    <>
      <form className="mb-3 flex gap-2" action="/recetas">
        <Input name="q" defaultValue={q} placeholder="Buscar recetas o etiquetas…" className="max-w-sm" />
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>
      {tagList.length ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {tagList.map((t) => (
            <Link key={t} href={tag === t ? "/recetas" : `/recetas?etiqueta=${encodeURIComponent(t)}`} className={`rounded-full border px-3 py-1 text-sm ${tag === t ? "border-herb bg-herb-soft text-herb" : "border-line hover:bg-paper-2"}`}>
              {t}
            </Link>
          ))}
        </div>
      ) : null}
      {rows.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ r, stars, n }) => (
            <li key={r.id}>
              <Link href={`/recetas/${r.id}`} className="group block overflow-hidden rounded-2xl border border-line bg-card transition-shadow hover:shadow-md">
                <div className="aspect-[16/9] bg-paper-2">
                  {r.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center text-ink-3">
                      <ChefHat className="size-10" />
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 font-semibold leading-snug">{r.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
                    {r.kcalPerServing ? <span className="num">{n0(r.kcalPerServing)} kcal/ración</span> : null}
                    {r.proteinPerServing ? <span className="num">P {n0(r.proteinPerServing)} g</span> : null}
                    {r.prepMin || r.cookMin ? (
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" /> {(r.prepMin ?? 0) + (r.cookMin ?? 0)} min
                      </span>
                    ) : null}
                    {stars ? (
                      <span className="flex items-center gap-0.5">
                        <Star className="size-3 fill-current text-persimmon" /> {stars.toFixed(1)} ({n})
                      </span>
                    ) : null}
                    {r.costPerServing ? <span className="num">{Number(r.costPerServing).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</span> : null}
                  </p>
                  {r.tags.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {r.tags.slice(0, 3).map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={<ChefHat className="size-8" />} title={q || tag ? "Sin resultados" : "Aún no hay recetas"}>
          Importa una desde una web o un vídeo, o escríbela tú.
        </Empty>
      )}
    </>
  );
}

export default function RecetasPage(props: PageProps<"/recetas">) {
  return (
    <>
      <PageHeader
        title="Recetas"
        subtitle="Del hogar, con nutrición por ración"
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/recetas/importar">
                <Download /> Importar
              </Link>
            </Button>
            <Button asChild>
              <Link href="/recetas/nueva">
                <Plus /> Nueva
              </Link>
            </Button>
          </>
        }
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <List searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
