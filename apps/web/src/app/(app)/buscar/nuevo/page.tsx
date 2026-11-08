import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/empty";
import { aiConfigured } from "@/lib/ai";
import { requireScope } from "@/lib/session";
import { NewFoodForm } from "./new-food-form";

export const metadata = { title: "Nuevo alimento" };

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireScope("diary", { write: true });
  const barcode = sp.barcode && /^\d{6,14}$/.test(sp.barcode) ? sp.barcode : null;
  return <NewFoodForm personId={ctx.person.id} barcode={barcode} label={sp.etiqueta === "1"} aiEnabled={aiConfigured() && ctx.scopes.has("ai")} />;
}

export default function NewFoodPage({ searchParams }: PageProps<"/buscar/nuevo">) {
  return (
    <>
      <PageHeader title="Nuevo alimento" subtitle="A mano o leyendo la etiqueta con la IA" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content searchParams={searchParams as Promise<Record<string, string | undefined>>} />
      </Suspense>
    </>
  );
}
