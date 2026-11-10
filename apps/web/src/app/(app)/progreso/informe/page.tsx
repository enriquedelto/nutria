import { Suspense } from "react";
import Link from "next/link";
import { and, desc, eq, insights } from "@nutria/db";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Empty, Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { requireScope } from "@/lib/session";

export const metadata = { title: "Informe semanal" };

const fmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", timeZone: "UTC" });
const range = (a: string | null, b: string | null) => (a && b ? `${fmt.format(new Date(`${a}T12:00:00Z`))} – ${fmt.format(new Date(`${b}T12:00:00Z`))}` : "");

async function Content() {
  const ctx = await requireScope("diary");
  const rows = await db()
    .select({ id: insights.id, title: insights.title, bodyMd: insights.bodyMd, data: insights.data, periodStart: insights.periodStart, periodEnd: insights.periodEnd })
    .from(insights)
    .where(and(eq(insights.personId, ctx.person.id), eq(insights.kind, "weekly")))
    .orderBy(desc(insights.periodStart), desc(insights.createdAt))
    .limit(26);
  if (!rows.length)
    return (
      <Card>
        <Empty title="Aún no hay informes">El coach prepara uno cada domingo por la tarde con tu alimentación, peso, entrenos y sueño. Mientras tanto, mira tu <Link href="/progreso" className="text-herb underline">progreso</Link>.</Empty>
      </Card>
    );
  const [last, ...older] = rows;
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-ink-3">{range(last!.periodStart, last!.periodEnd)}</p>
        <h2 className="mb-2 font-display text-xl font-semibold">{last!.title}</h2>
        <OneChange text={last!.data.cambio} />
        <Markdown text={last!.bodyMd} />
      </Card>
      {older.length ? (
        <Card>
          <h2 className="mb-2 font-display text-lg font-semibold">Semanas anteriores</h2>
          <ul className="divide-y divide-line">
            {older.map((r) => (
              <li key={r.id} className="py-2">
                <details>
                  <summary className="cursor-pointer">
                    <span className="font-medium">{r.title}</span> <span className="text-sm text-ink-3">· {range(r.periodStart, r.periodEnd)}</span>
                  </summary>
                  <div className="mt-2">
                    <OneChange text={r.data.cambio} />
                    <Markdown text={r.bodyMd} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function OneChange({ text }: { text: unknown }) {
  if (typeof text !== "string" || !text) return null;
  return (
    <p className="mb-3 rounded-xl bg-herb-soft/60 p-3 text-sm">
      <span className="block text-xs font-medium uppercase tracking-wide text-herb">Un cambio para esta semana</span>
      <span className="font-medium">{text}</span>
    </p>
  );
}

export default function InformeSemanalPage() {
  return (
    <>
      <PageHeader title="Informe semanal" subtitle="Lo que ha ido bien y qué cambiar, cada semana" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}
