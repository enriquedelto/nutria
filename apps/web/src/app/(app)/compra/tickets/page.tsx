import { Suspense } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Empty, Skeleton } from "@/components/ui/empty";
import { listReceipts } from "@/lib/data/receipts";
import { dateShort } from "@/lib/format";
import { kitchenContext } from "@/lib/kitchen";
import { ReceiptScan } from "./receipt-scan";

export const metadata = { title: "Tickets" };

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const k = await kitchenContext();
  const rows = await listReceipts(k.groupId);
  const listId = sp.lista && /^[0-9a-f-]{36}$/i.test(sp.lista) ? sp.lista : null;
  return (
    <div className="space-y-4">
      <Card>
        <ReceiptScan listId={listId} />
      </Card>
      {rows.length ? (
        <Card className="p-1">
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/compra/tickets/${r.id}`} className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-paper-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.store ?? "Tienda sin confirmar"}</span>
                    <span className="text-xs text-ink-3">
                      {r.purchasedOn ? dateShort(r.purchasedOn) : "Sin fecha"} · {r.lines} {r.lines === 1 ? "línea" : "líneas"}
                    </span>
                  </span>
                  {r.status === "draft" ? <Badge tone="warn">Por revisar</Badge> : null}
                  {r.openPrices?.status === "shared" ? <Badge tone="neutral">Open Prices</Badge> : r.openPrices?.status === "error" ? <Badge tone="danger">Error al compartir</Badge> : null}
                  <span className="num shrink-0 font-medium">{r.total != null ? eur.format(Number(r.total)) : "—"}</span>
                  <ChevronRight className="size-4 shrink-0 text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <Empty title="Aún no hay tickets">Fotografía el ticket después de la compra: se guardan los precios con su fecha y verás cómo cambian.</Empty>
        </Card>
      )}
    </div>
  );
}

export default function TicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <>
      <PageHeader
        title="Tickets"
        subtitle="Precios de lo que compras, con su fecha"
        actions={
          <Link href="/compra/precios" className="text-sm font-medium text-herb">
            Ver precios
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}
