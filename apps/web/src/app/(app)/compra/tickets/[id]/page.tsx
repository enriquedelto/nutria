import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { openPricesAccount } from "@nutria/core";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { receiptDetail } from "@/lib/data/receipts";
import { dateLong, n1 } from "@/lib/format";
import { kitchenContext } from "@/lib/kitchen";
import { ReceiptActions } from "./receipt-actions";
import { ReceiptReview } from "./review-client";

export const metadata = { title: "Ticket" };

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

async function Content({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const k = await kitchenContext();
  const d = await receiptDetail(k.groupId, id);
  if (!d) notFound();
  const { receipt: r, items, reading, store } = d;
  const images = r.files.map((f, i) => ({ ...f, i })).filter((f) => f.mime.startsWith("image/"));

  if (r.status === "draft" || sp.editar === "1") {
    const acc = await openPricesAccount(db(), k.user.id);
    return (
      <>
        <PageHeader title={r.status === "draft" ? "Revisar ticket" : "Editar ticket"} subtitle="Comprueba la tienda, la fecha y cada línea antes de guardar" />
        {images.length ? <Thumbs id={r.id} images={images} /> : null}
        <ReceiptReview
          receiptId={r.id}
          personId={k.person.id}
          date={r.purchasedOn}
          total={r.total}
          header={{ name: reading.store.name ?? reading.store.chain, address: reading.store.address, city: reading.store.city }}
          storeId={r.storeId}
          knownStores={d.knownStores.some((s) => s.id === r.storeId) || !store ? d.knownStores : [{ id: store.id, name: store.name, address: store.address, osmId: store.osmId }, ...d.knownStores]}
          candidates={r.storeId ? [] : reading.candidates}
          lines={items.map((i) => ({ rawText: i.rawText, name: i.name, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, lineTotal: i.lineTotal, discount: i.discount, foodId: i.foodId, foodName: i.food?.name ?? null, matchConfidence: i.matchConfidence }))}
          shareImage={r.openPrices?.status === "shared" ? null : (images.at(-1)?.i ?? null)}
          cropBottom={reading.cropBottom}
          openPricesConnected={acc?.status === "active"}
          fromList={!!r.shoppingListId}
        />
      </>
    );
  }

  const op = r.openPrices;
  return (
    <>
      <PageHeader title={store?.name ?? "Ticket"} subtitle={[r.purchasedOn ? dateLong(r.purchasedOn) : null, r.purchasedTime].filter(Boolean).join(" · ")} />
      <div className="space-y-4">
        {images.length ? <Thumbs id={r.id} images={images} /> : null}
        <Card>
          <CardHeader title={`${items.length} ${items.length === 1 ? "línea" : "líneas"}`} subtitle={r.total != null ? `Total ${eur.format(r.total)}` : undefined} />
          <ul className="divide-y divide-line text-sm">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  {i.food ? (
                    <Link href={`/alimentos/${i.food.id}`} className="block truncate font-medium text-herb">
                      {i.food.name}
                    </Link>
                  ) : (
                    <span className="block truncate font-medium">{i.name}</span>
                  )}
                  <span className="text-xs text-ink-3">
                    {i.unit === "ud" ? `${n1(i.quantity)} ud` : `${n1(i.quantity)} ${i.unit}`}
                    {i.unitPrice != null ? ` × ${eur.format(i.unitPrice)}${i.unit === "ud" ? "" : `/${i.unit}`}` : ""}
                    {i.discount ? ` · −${eur.format(i.discount)}` : ""}
                  </span>
                </span>
                <span className="num shrink-0 font-medium">{eur.format(i.lineTotal)}</span>
              </li>
            ))}
          </ul>
        </Card>
        {op ? (
          <Card>
            <CardHeader title="Open Prices" />
            {op.status === "shared" ? (
              <p className="text-sm">
                <Badge tone="neutral">Compartido</Badge> {op.prices ?? 0} {op.prices === 1 ? "precio publicado" : "precios publicados"}
                {op.skipped ? ` · ${op.skipped} sin código de barras o no aceptados` : ""}.
              </p>
            ) : op.status === "pending" ? (
              <p className="text-sm text-ink-2">Compartiendo… recarga en unos segundos.</p>
            ) : (
              <p className="text-sm text-danger">{op.error ?? "No se pudo compartir"}</p>
            )}
          </Card>
        ) : null}
        <ReceiptActions receiptId={r.id} canRetryShare={op?.status === "error" && !!r.shareKey} />
      </div>
    </>
  );
}

function Thumbs({ id, images }: { id: string; images: { i: number }[] }) {
  return (
    <ul className="mb-4 flex gap-2 overflow-x-auto">
      {images.map((f) => (
        <li key={f.i}>
          <a href={`/api/receipts/${id}/file/${f.i}`} target="_blank" rel="noreferrer" aria-label={`Foto ${f.i + 1} del ticket`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/receipts/${id}/file/${f.i}`} alt="" className="h-28 w-auto rounded-lg border border-line bg-white object-cover" loading="lazy" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}
