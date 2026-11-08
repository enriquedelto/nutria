import { Suspense } from "react";
import Link from "next/link";
import { Package, Refrigerator, Snowflake, Sparkles } from "lucide-react";
import { and, asc, batches, eq, gt, pantryItems, sql } from "@nutria/db";
import { expiryStatus, todayIn } from "@nutria/nutrition";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty, Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { dateShort, n1 } from "@/lib/format";
import { kitchenContext } from "@/lib/kitchen";
import { AddPantry, BatchDone, PantryRow } from "./pantry-client";

export const metadata = { title: "Despensa" };

const LOCS = [
  ["nevera", "Nevera", Refrigerator],
  ["congelador", "Congelador", Snowflake],
  ["despensa", "Despensa", Package],
] as const;

function label(expiresOn: string | null, today: string) {
  if (!expiresOn) return "sin fecha";
  const d = Math.round((Date.parse(expiresOn) - Date.parse(today)) / 86_400_000);
  if (d < 0) return `caducó hace ${-d} día${d === -1 ? "" : "s"}`;
  if (d === 0) return "caduca hoy";
  if (d === 1) return "caduca mañana";
  if (d <= 7) return `caduca en ${d} días`;
  return `caduca el ${dateShort(expiresOn)}`;
}

async function Content() {
  const k = await kitchenContext();
  const today = todayIn(k.person.timezone);
  const [items, tuppers] = await Promise.all([
    db().select().from(pantryItems).where(eq(pantryItems.groupId, k.groupId)).orderBy(sql`${pantryItems.expiresOn} asc nulls last`, asc(pantryItems.name)),
    db().select().from(batches).where(and(eq(batches.groupId, k.groupId), gt(batches.portionsLeft, 0))).orderBy(asc(batches.expiresOn)),
  ]);
  const urgent = items.filter((i) => ["expired", "soon"].includes(expiryStatus(i.expiresOn, today)));
  return (
    <div className="space-y-4">
      <Card>
        <AddPantry />
      </Card>
      {urgent.length ? (
        <Card className="border-persimmon/50">
          <CardHeader
            title="Úsalo pronto"
            subtitle={urgent.map((u) => u.name).join(", ")}
            action={
              k.scopes.has("ai") ? (
                <Button asChild size="sm" variant="soft">
                  <Link href={`/coach?q=${encodeURIComponent(`¿Qué puedo cocinar hoy aprovechando ${urgent.map((u) => u.name).join(", ")}?`)}`}>
                    <Sparkles /> Ideas
                  </Link>
                </Button>
              ) : null
            }
          />
        </Card>
      ) : null}
      {tuppers.length ? (
        <Card>
          <CardHeader title="Tuppers" subtitle="Se descuentan al registrarlos en el diario" />
          <ul className="divide-y divide-line text-sm">
            {tuppers.map((b) => (
              <li key={b.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  <b className="font-medium">{b.title}</b> <span className="num text-ink-2">· {n1(b.portionsLeft)} de {n1(b.portionsTotal)} raciones</span>
                  <span className={`block text-xs ${expiryStatus(b.expiresOn, today) === "ok" || !b.expiresOn ? "text-ink-3" : "font-semibold text-persimmon"}`}>
                    {b.location} · cocinado el {dateShort(b.cookedOn)} · {label(b.expiresOn, today)}
                  </span>
                </span>
                <BatchDone id={b.id} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {items.length ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {LOCS.map(([code, name, Icon]) => {
            const here = items.filter((i) => i.location === code);
            return (
              <Card key={code}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <Icon className="size-5 text-herb" /> {name}
                    </span>
                  }
                  subtitle={`${here.length} productos`}
                />
                <ul className="divide-y divide-line">
                  {here.map((i) => (
                    <PantryRow key={i.id} item={i} status={expiryStatus(i.expiresOn, today)} label={label(i.expiresOn, today)} />
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      ) : (
        <Empty icon={<Package className="size-8" />} title="La despensa está vacía">
          Escanea productos, haz una foto de la nevera o termina una compra para llenarla.
        </Empty>
      )}
    </div>
  );
}

export default function DespensaPage() {
  return (
    <>
      <PageHeader title="Despensa" subtitle="Caducidades, tuppers y lo que hay en casa" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}
