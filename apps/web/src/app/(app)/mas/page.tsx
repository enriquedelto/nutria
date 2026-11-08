import { Suspense } from "react";
import { MoreGrid } from "@/components/nav";
import { PageHeader } from "@/components/page-header";
import { getPersonContext } from "@/lib/session";

export const metadata = { title: "Más" };

async function Grid() {
  const ctx = await getPersonContext();
  return <MoreGrid admin={ctx.user.role === "admin"} />;
}

export default function MasPage() {
  return (
    <>
      <PageHeader title="Más" />
      <Suspense fallback={<MoreGrid />}>
        <Grid />
      </Suspense>
    </>
  );
}
