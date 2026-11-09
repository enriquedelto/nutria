import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty, Skeleton } from "@/components/ui/empty";
import { priceInsights } from "@/lib/data/receipts";
import { dateShort, n0 } from "@/lib/format";
import { kitchenContext } from "@/lib/kitchen";
import { cn } from "@/lib/utils";
import { PriceChart } from "@/components/charts/price-chart";
import { ChangesTabs } from "./changes-tabs";

export const metadata = { title: "Precios" };

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const monthName = new Intl.DateTimeFormat("es-ES", { month: "short", year: "2-digit", timeZone: "UTC" });

async function Content() {
  const k = await kitchenContext();
  const d = await priceInsights(k.groupId);
  if (!d.tracked)
    return (
      <Card>
        <Empty title="Aún no hay precios de tus tickets">
          <Link href="/compra/tickets" className="text-herb underline">
            Escanea un ticket
          </Link>{" "}
          y aquí verás cuánto gastas al mes y cómo cambian los precios de lo que compras.
        </Empty>
      </Card>
    );
  const lastSpend = d.spend.at(-1);
  const change = (c: (typeof d.changes3)[number]) => (
    <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
      <Link href={`/alimentos/${c.id}`} className="min-w-0 hover:text-herb">
        <span className="block truncate font-medium">{c.name}</span>
        <span className="text-xs text-ink-3">
          {eur.format(c.from.value)} ({dateShort(c.from.date)}) → {eur.format(c.to.value)} ({dateShort(c.to.date)})
        </span>
      </Link>
      <span className={cn("num shrink-0 font-medium", c.pct > 0 ? "text-persimmon" : "text-herb")}>
        {c.pct > 0 ? "+" : ""}
        {n0(c.pct)} %
      </span>
    </li>
  );
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Gasto por mes" subtitle={lastSpend ? `${eur.format(lastSpend.total)} en ${monthName.format(new Date(`${lastSpend.month}-15T12:00:00Z`))} · ${lastSpend.receipts} tickets` : undefined} />
        <PriceChart data={d.spend.map((s) => ({ date: `${s.month}-01`, value: Math.round(s.total * 100) / 100 }))} unit="€" />
      </Card>

      <Card>
        <CardHeader title="Mi cesta" subtitle={d.basket.length ? `Precio de lo que compras habitualmente (${d.habitualCount} productos), base 100 = la primera vez` : undefined} />
        {d.basket.length >= 2 ? (
          <>
            <PriceChart data={d.basket.map((b) => ({ date: `${b.month}-01`, value: b.index }))} unit="" />
            <p className="text-sm text-ink-2">
              Último mes: <strong className="num">{n0(d.basket.at(-1)!.index)}</strong> ({d.basket.at(-1)!.index >= 100 ? "+" : ""}
              {n0(d.basket.at(-1)!.index - 100)} % desde que empezaste a guardar tickets).
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-3">Hace falta comprar los mismos productos en al menos tres meses distintos para ver la tendencia.</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Lo que más ha cambiado" subtitle="Por kg o litro cuando se sabe; si no, por unidad" />
        <ChangesTabs
          three={d.changes3.length ? <ul className="divide-y divide-line">{d.changes3.map(change)}</ul> : <p className="py-2 text-sm text-ink-3">Sin cambios en los últimos 3 meses.</p>}
          twelve={d.changes12.length ? <ul className="divide-y divide-line">{d.changes12.map(change)}</ul> : <p className="py-2 text-sm text-ink-3">Sin cambios en el último año.</p>}
        />
      </Card>

      {d.acrossStores.length ? (
        <Card>
          <CardHeader title="El mismo producto en otras tiendas" subtitle="Último precio en cada una (4 meses)" />
          <ul className="divide-y divide-line text-sm">
            {d.acrossStores.map((a) => (
              <li key={a.id} className="py-2">
                <Link href={`/alimentos/${a.id}`} className="font-medium hover:text-herb">
                  {a.name}
                </Link>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {a.stores.map((s, i) => (
                    <li key={s.storeId} className={cn("flex justify-between", i === 0 ? "text-herb" : "text-ink-2")}>
                      <span>
                        {s.store} · {dateShort(s.date)}
                      </span>
                      <span className="num">{eur.format(s.value)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

export default function PreciosPage() {
  return (
    <>
      <PageHeader
        title="Precios"
        subtitle="Cómo cambian los precios de lo que compras"
        actions={
          <Link href="/compra/tickets" className="text-sm font-medium text-herb">
            Tickets
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}
