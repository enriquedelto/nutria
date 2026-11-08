import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/empty";
import { ImportClient } from "./import-client";

export const metadata = { title: "Importar receta" };

async function Body({ searchParams }: { searchParams: PageProps<"/recetas/importar">["searchParams"] }) {
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  // Share target may pass the link inside "text" (Android puts URLs there).
  const shared = pick("url") ?? pick("text")?.match(/https?:\/\/\S+/)?.[0];
  const est = pick("estimacion");
  return <ImportClient initialUrl={shared} estimateId={est && /^[0-9a-f-]{36}$/.test(est) ? est : undefined} />;
}

export default function ImportarPage(props: PageProps<"/recetas/importar">) {
  return (
    <>
      <PageHeader title="Importar receta" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Body searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
