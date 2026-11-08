import { Suspense } from "react";
import { notFound } from "next/navigation";
import { recipeDetail } from "@nutria/core";
import { db } from "@/lib/db";
import { kitchenContext } from "@/lib/kitchen";
import { CookMode } from "./cook-mode";

export const metadata = { title: "Modo cocina" };

async function Content({ params }: { params: PageProps<"/recetas/[id]/cocinar">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const k = await kitchenContext();
  const d = await recipeDetail(db(), id, k.groupId);
  if (!d) notFound();
  return <CookMode id={d.recipe.id} title={d.recipe.title} steps={d.steps.map((s) => ({ text: s.text, timerSec: s.timerSec }))} ingredients={d.ingredients.map((i) => i.rawText)} />;
}

export default function CocinarPage(props: PageProps<"/recetas/[id]/cocinar">) {
  return (
    <Suspense fallback={null}>
      <Content params={props.params} />
    </Suspense>
  );
}
