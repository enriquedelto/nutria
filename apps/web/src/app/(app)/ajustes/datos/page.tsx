import { Suspense } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { and, desc, eq, imports } from "@nutria/db";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { getPersonContext } from "@/lib/session";
import { DeleteAccount, ImportCsv } from "./data-client";

export const metadata = { title: "Tus datos" };

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral" }> = {
  pending: { label: "en cola", tone: "neutral" },
  running: { label: "importando", tone: "warn" },
  done: { label: "hecho", tone: "ok" },
  failed: { label: "error", tone: "danger" },
};
const SOURCE: Record<string, string> = { mfp: "MyFitnessPal", loseit: "Lose It!", cronometer: "Cronometer", waistline: "Waistline", generic: "CSV", auto: "CSV" };

async function Content() {
  const ctx = await getPersonContext();
  const pid = ctx.person.id;
  const list = await db().select().from(imports).where(and(eq(imports.userId, ctx.user.id), eq(imports.personId, pid))).orderBy(desc(imports.createdAt)).limit(10);
  const csv = ["diario", "pesos", "medidas", "ejercicio", "sueno", "analiticas"];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Importar" subtitle={`Al diario de ${ctx.person.name}: exportación CSV de MyFitnessPal, Lose It!, Cronometer o Waistline. Se detecta el formato solo.`} />
        {ctx.canWrite ? <ImportCsv personId={pid} /> : <p className="text-sm text-ink-3">Sin permiso de escritura.</p>}
        {list.length ? (
          <ul className="mt-4 divide-y divide-line text-sm">
            {list.map((i) => (
              <li key={i.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">
                  {i.fileName ?? "archivo.csv"} <span className="text-ink-3">· {SOURCE[i.source] ?? i.source}</span>
                  {i.status === "done" ? (
                    <span className="block text-xs text-ink-3">
                      {i.stats.entries ?? 0} alimentos · {i.stats.weights ?? 0} pesajes · {i.stats.skipped ?? 0} filas ignoradas
                    </span>
                  ) : i.error ? (
                    <span className="block text-xs text-danger">{i.error}</span>
                  ) : null}
                </span>
                <Badge tone={STATUS[i.status]?.tone ?? "neutral"}>{STATUS[i.status]?.label ?? i.status}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Card>
        <CardHeader title="Exportar" subtitle="Todo lo que tienes permiso para ver de esta persona" />
        <div className="flex flex-wrap gap-2">
          <a className="inline-flex h-10 items-center gap-2 rounded-full bg-herb px-4 text-sm font-medium text-herb-ink" href={`/api/export?personId=${pid}&format=json`}>
            <Download className="size-4" /> Todo (JSON)
          </a>
          {csv.map((t) => (
            <a key={t} className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium hover:bg-paper-2" href={`/api/export?personId=${pid}&format=csv&table=${t}`}>
              {t}.csv
            </a>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-3">Para tu nutricionista: <Link href="/informe" className="text-herb underline">informe imprimible o en PDF</Link> con medias, micronutrientes, peso y síntomas.</p>
      </Card>
      <Card className="border-danger/40">
        <CardHeader title="Zona peligrosa" />
        <DeleteAccount email={ctx.user.email} />
      </Card>
    </div>
  );
}

export default function DatosPage() {
  return (
    <>
      <PageHeader title="Tus datos" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}
