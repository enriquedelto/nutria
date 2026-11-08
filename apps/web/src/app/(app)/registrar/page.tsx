import { Suspense } from "react";
import { todayIn } from "@nutria/nutrition";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/empty";
import { aiConfigured } from "@/lib/ai";
import { getDay } from "@/lib/data/day";
import { dateLong, isDate } from "@/lib/format";
import { requireScope } from "@/lib/session";
import { closestSlot } from "@/lib/slots";
import { readShareMeta } from "@/lib/uploads";
import { RegisterClient } from "./register-client";

export const metadata = { title: "Registrar con IA" };

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireScope("diary", { write: true });
  const date = isDate(sp.fecha) ? sp.fecha : todayIn(ctx.person.timezone);
  const day = await getDay(ctx.person.id, date);
  const slots = day.meals.filter((m) => m.key !== "other").map((m) => ({ key: m.key, label: m.label }));
  const wanted = sp.comida ?? closestSlot(day.meals, ctx.person.timezone);
  const slot = slots.some((s) => s.key === wanted) ? wanted : (slots[0]?.key ?? "lunch");
  let shared: string[] = [];
  if (sp.compartido && /^[0-9a-f-]{36}$/.test(sp.compartido)) {
    const meta = await readShareMeta(sp.compartido);
    if (meta?.userId === ctx.user.id) shared = meta.names.filter((n) => !n.endsWith(".pdf")).map((n) => `/api/share-target/${sp.compartido}/${n}`);
  }
  return (
    <>
      <PageHeader title="Registrar con IA" subtitle={<span className="capitalize">{dateLong(date)} · {ctx.person.name}</span>} />
      <RegisterClient
        aiEnabled={aiConfigured() && ctx.scopes.has("ai")}
        sharedImages={shared}
        ctx={{
          personId: ctx.person.id,
          date,
          slot,
          slots,
          totals: { kcal: day.totals.energy_kcal ?? 0, protein: day.totals.protein ?? 0, carbs: day.totals.carbs ?? 0, fat: day.totals.fat ?? 0 },
          target: day.target ? { kcal: day.target.kcal, protein: day.target.protein, carbs: day.target.carbs, fat: day.target.fat } : null,
          favoriteIds: [],
        }}
      />
      <p className="mt-6 text-xs text-ink-3">La IA estima cantidades y nutrientes: revisa antes de guardar. Todo lo registrado con IA se puede deshacer.</p>
    </>
  );
}

export default function RegistrarPage({ searchParams }: PageProps<"/registrar">) {
  return (
    <Suspense fallback={<Skeleton className="h-80" />}>
      <Content searchParams={searchParams as Promise<Record<string, string | undefined>>} />
    </Suspense>
  );
}
