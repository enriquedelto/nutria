import { Suspense } from "react";
import { MoreGrid } from "@/components/nav";
import { HIDEABLE_SECTIONS } from "@/lib/sections";
import { PageHeader } from "@/components/page-header";
import { getPersonContext } from "@/lib/session";

export const metadata = { title: "Más" };

async function Grid() {
  const ctx = await getPersonContext();
  return <MoreGrid admin={ctx.user.role === "admin"} hidden={ctx.hiddenSections} />;
}

export default function MasPage() {
  return (
    <>
      <PageHeader title="Más" />
      <Suspense fallback={<MoreGrid hidden={HIDEABLE_SECTIONS} />}>
        <Grid />
      </Suspense>
    </>
  );
}
