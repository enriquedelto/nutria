import { PageHeader } from "@/components/page-header";
import { RecipeForm } from "@/components/kitchen/recipe-form";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Nueva receta" };

export default function NuevaRecetaPage() {
  return (
    <>
      <PageHeader title="Nueva receta" subtitle="La nutrición se calcula sola a partir de los ingredientes" />
      <Card>
        <RecipeForm />
      </Card>
    </>
  );
}
