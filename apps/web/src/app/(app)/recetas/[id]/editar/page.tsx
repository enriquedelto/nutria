import { Suspense } from "react";
import { notFound } from "next/navigation";
import { recipeDetail } from "@nutria/core";
import { RecipeForm } from "@/components/kitchen/recipe-form";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { kitchenContext } from "@/lib/kitchen";

async function Content({ params }: { params: PageProps<"/recetas/[id]/editar">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const k = await kitchenContext();
  const d = await recipeDetail(db(), id, k.groupId);
  if (!d) notFound();
  const r = d.recipe;
  return (
    <>
      <PageHeader title={`Editar «${r.title}»`} />
      <Card>
        <RecipeForm
          recipeId={r.id}
          initial={{
            title: r.title,
            description: r.description,
            servings: r.servings,
            prepMin: r.prepMin,
            cookMin: r.cookMin,
            imageUrl: r.imageUrl,
            sourceUrl: r.sourceUrl,
            sourceType: r.sourceType as "manual",
            tags: r.tags,
            freezable: r.freezable,
            fridgeDays: r.fridgeDays,
            totalWeightG: r.totalWeightG,
            ingredients: d.ingredients.map((i) => ({ rawText: i.rawText, foodId: i.foodId, grams: null, section: i.section, optional: i.optional })),
            steps: d.steps.map((s) => ({ text: s.text, timerSec: s.timerSec })),
          }}
        />
      </Card>
    </>
  );
}

export default function EditarRecetaPage(props: PageProps<"/recetas/[id]/editar">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Content params={props.params} />
    </Suspense>
  );
}
