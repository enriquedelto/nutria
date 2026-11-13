import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { FOOD_GROUP_BY_KEY, NUTRIENT_BY_CODE, NUTRIENTS, scaleNutrients, todayIn, type NutrientMap } from "@nutria/nutrition";
import { NutriBadges } from "@/components/food/add-food-dialog";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { getDay } from "@/lib/data/day";
import { foodDetail, foodPrices, quickLists } from "@/lib/data/foods";
import { dateShort, n0, nutrient } from "@/lib/format";
import { closestSlot } from "@/lib/slots";
import { requireScope } from "@/lib/session";
import { cn } from "@/lib/utils";
import { FoodActions } from "./food-actions";
import { PriceChart } from "@/components/charts/price-chart";

export const metadata = { title: "Alimento" };

const SOURCE: Record<string, string> = { off: "Open Food Facts", ciqual: "Genérico (CIQUAL)", store: "Supermercado", custom: "Creado por ti", ai: "Estimado con IA", recipe: "Receta", usda: "USDA" };
const PRICE_SOURCE: Record<string, string> = { open_prices: "Open Prices", store: "web de la tienda", manual: "a mano", receipt: "ticket" };
const SECTIONS: { title: string; cats: string[] }[] = [
  { title: "Hidratos y fibra", cats: ["carb_detail"] },
  { title: "Grasas", cats: ["fat_detail"] },
  { title: "Vitaminas", cats: ["vitamin"] },
  { title: "Minerales", cats: ["mineral"] },
  { title: "Otros", cats: ["other"] },
];
const MAIN = ["energy_kcal", "protein", "carbs", "sugars", "fat", "sat_fat", "fiber", "salt"];
const SUB = new Set(["sugars", "sat_fat"]);
const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

type PriceRow = Awaited<ReturnType<typeof foodPrices>>[number];

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireScope("diary");
  const detail = await foodDetail(id, ctx.person.id, ctx.person.groupId);
  if (!detail) notFound();
  const { food: f, servings, additives, alerts, alternatives } = detail;
  const date = todayIn(ctx.person.timezone);
  const [day, lists, priceRows] = await Promise.all([getDay(ctx.person.id, date), quickLists(ctx.person.id), foodPrices(f, ctx.person.groupId)]);
  const slots = day.meals.filter((m) => m.key !== "other").map((m) => ({ key: m.key, label: m.label, time: m.time }));
  const slot = closestSlot(day.meals, ctx.person.timezone);
  const dayCtx = {
    personId: ctx.person.id,
    date,
    today: date,
    slot: slots.some((s) => s.key === slot) ? slot : (slots[0]?.key ?? "lunch"),
    slots,
    totals: { kcal: day.totals.energy_kcal ?? 0, protein: day.totals.protein ?? 0, carbs: day.totals.carbs ?? 0, fat: day.totals.fat ?? 0 },
    target: day.target ? { kcal: day.target.kcal, protein: day.target.protein, carbs: day.target.carbs, fat: day.target.fat } : null,
    favoriteIds: lists.favoriteIds,
  };

  const per100: NutrientMap = { ...f.nutrients };
  const cols: [string, number | null][] = [["energy_kcal", f.kcal], ["protein", f.protein], ["carbs", f.carbs], ["sugars", f.sugars], ["fat", f.fat], ["sat_fat", f.satFat], ["fiber", f.fiber], ["salt", f.salt]];
  for (const [k, v] of cols) if (v != null) per100[k] = v;
  const hasNutrients = f.kcal != null;
  const serving = servings[0];
  const perServing = serving ? scaleNutrients(per100, serving.grams) : null;
  const unit = f.kind === "drink" ? "100 ml" : "100 g";
  const group = f.foodGroup ? FOOD_GROUP_BY_KEY[f.foodGroup] : undefined;
  const main = MAIN.filter((c) => per100[c] != null);
  const rest = SECTIONS.map((s) => ({ ...s, codes: NUTRIENTS.filter((n) => s.cats.includes(n.category) && !MAIN.includes(n.code) && (per100[n.code] ?? 0) > 0).map((n) => n.code) })).filter((s) => s.codes.length);

  // Prices: per kg when known (comparable across pack sizes), otherwise per unit.
  const perKg = priceRows.some((p) => p.pricePerKg != null);
  const value = (p: PriceRow) => (perKg ? (p.pricePerKg ?? p.price) : p.price);
  const series = [...priceRows].reverse().map((p) => ({ date: p.observedOn, value: value(p) }));
  const stores = new Map<string, { store: string; last: PriceRow; first: PriceRow; min: number; max: number; n: number }>();
  for (const p of priceRows) {
    const k = p.store ?? "Sin tienda";
    const cur = stores.get(k);
    if (!cur) stores.set(k, { store: k, last: p, first: p, min: value(p), max: value(p), n: 1 });
    else Object.assign(cur, { first: p, min: Math.min(cur.min, value(p)), max: Math.max(cur.max, value(p)), n: cur.n + 1 });
  }

  const table = (codes: string[]) => (
    <table className="w-full text-sm">
      <thead className="sr-only">
        <tr>
          <th>Nutriente</th>
          <th>Por {unit}</th>
          {perServing ? <th>Por ración</th> : null}
        </tr>
      </thead>
      <tbody>
        {codes.map((code) => (
          <tr key={code} className="border-t border-line">
            <th scope="row" className={cn("py-1.5 pr-2 text-left font-normal", SUB.has(code) && "pl-3 text-ink-2")}>
              {NUTRIENT_BY_CODE[code]?.nameEs ?? code}
            </th>
            <td className="num py-1.5 text-right">{nutrient(code, per100[code]!)}</td>
            {perServing ? <td className="num py-1.5 pl-3 text-right text-ink-2">{nutrient(code, perServing[code] ?? 0)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <PageHeader title={f.nameEs ?? f.name} subtitle={[f.brand, f.quantityLabel].filter(Boolean).join(" · ") || SOURCE[f.source]} />
      <div className="space-y-4">
        <Card>
          <div className="flex items-start gap-4">
            {f.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.imageUrl} alt="" className="size-20 shrink-0 rounded-xl border border-line bg-white object-contain sm:size-24" />
            ) : null}
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <NutriBadges nutriscore={f.nutriscore} nova={f.nova} />
                {group ? <Badge tone="neutral">{group.name}</Badge> : null}
                <Badge tone="neutral">{SOURCE[f.source] ?? f.source}</Badge>
                {f.barcode ? <span className="num text-xs text-ink-3">EAN {f.barcode}</span> : null}
              </div>
              {hasNutrients ? (
                <p className="num text-sm text-ink-2">
                  Por {unit}: <strong className="text-ink">{n0(f.kcal)} kcal</strong> · P {n0(f.protein)} g · H {n0(f.carbs)} g · G {n0(f.fat)} g
                  {f.kcal ? ` · ${n0(((f.protein ?? 0) / f.kcal) * 100)} g de proteína por 100 kcal` : ""}
                </p>
              ) : (
                <p className="text-sm text-ink-3">Sin información nutricional: es un producto del catálogo de la tienda.</p>
              )}
              <FoodActions foodId={f.id} ctx={dayCtx} canLog={hasNutrients} canWrite={ctx.canWrite} />
            </div>
          </div>
        </Card>

        {alerts.length ? (
          <ul className="space-y-1.5">
            {alerts.map((a, i) => (
              <li key={i} className={cn("flex gap-2 rounded-xl px-3 py-2 text-sm", a.level === "avoid" ? "bg-danger/10 text-danger" : a.level === "caution" ? "bg-warn/20" : "bg-paper-2")}>
                {a.level === "avoid" ? <ShieldAlert className="mt-0.5 size-4 shrink-0" /> : a.level === "caution" ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
                <span>
                  <span className="font-medium capitalize">{a.kind}:</span> {a.message}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {hasNutrients ? (
          <Card>
            <CardHeader title="Información nutricional" subtitle={perServing ? `Por ${unit} y por ${serving!.label} (${n0(serving!.grams)} g)` : `Por ${unit}`} />
            {table(main)}
            {rest.map((s) => (
              <details key={s.title} className="mt-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {s.title} <span className="text-ink-3">({s.codes.length})</span>
                </summary>
                {table(s.codes)}
              </details>
            ))}
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Precio" subtitle={priceRows.length ? `${priceRows.length} ${priceRows.length === 1 ? "registro" : "registros"}${perKg ? " · gráfica en €/kg" : ""}` : undefined} />
          {priceRows.length ? (
            <div className="space-y-3">
              {new Set(series.map((s) => s.date)).size > 1 ? <PriceChart data={series} unit={perKg ? "€/kg" : "€"} /> : null}
              <ul className="divide-y divide-line text-sm">
                {[...stores.values()].map((s) => {
                  const change = s.n > 1 && value(s.first) ? ((value(s.last) - value(s.first)) / value(s.first)) * 100 : null;
                  return (
                    <li key={s.store} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block font-medium">{s.store}</span>
                        <span className="text-xs text-ink-3">
                          {dateShort(s.last.observedOn)} · {PRICE_SOURCE[s.last.source] ?? s.last.source}
                          {s.n > 1 ? ` · mín. ${eur.format(s.min)} · máx. ${eur.format(s.max)}` : ""}
                        </span>
                      </span>
                      <span className="num shrink-0 text-right">
                        <span className="block font-medium">{eur.format(s.last.price)}</span>
                        {s.last.pricePerKg ? <span className="text-xs text-ink-3">{eur.format(s.last.pricePerKg)}/kg</span> : null}
                        {change != null && Math.abs(change) >= 0.5 ? (
                          <span className={cn("block text-xs", change > 0 ? "text-persimmon" : "text-herb")}>
                            {change > 0 ? "+" : ""}
                            {n0(change)} % desde {dateShort(s.first.observedOn)}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-ink-3">Aún no hay precios guardados. Se rellenan con los tickets de compra, Open Prices y el catálogo de la tienda.</p>
          )}
        </Card>

        {f.ingredientsText || additives.length ? (
          <Card>
            <CardHeader title="Ingredientes" />
            {f.ingredientsText ? <p className="text-sm text-ink-2">{f.ingredientsText}</p> : null}
            {additives.length ? (
              <ul className="mt-3 space-y-1 text-sm">
                {additives.map((a) => (
                  <li key={a.code}>
                    <span className="font-medium uppercase">{a.code.replace("en:", "")}</span> {a.name}
                    {a.risk && a.risk !== "none" ? (
                      <Badge tone={a.risk === "high" ? "danger" : a.risk === "moderate" ? "warn" : "neutral"} className="ml-1">
                        riesgo {a.risk === "high" ? "alto" : a.risk === "moderate" ? "moderado" : "bajo"}
                      </Badge>
                    ) : null}
                    {a.descriptionEs ? <span className="block text-xs text-ink-3">{a.descriptionEs}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}

        {alternatives.length ? (
          <Card>
            <CardHeader title="Alternativas más sanas" />
            <ul className="divide-y divide-line">
              {alternatives.map((a) => (
                <li key={a.id}>
                  <Link href={`/alimentos/${a.id}`} className="flex items-center justify-between gap-3 py-2 hover:text-herb">
                    <span className="min-w-0 truncate">{a.name}</span>
                    <span className="flex shrink-0 items-center gap-2 text-sm">
                      <NutriBadges nutriscore={a.nutriscore} nova={a.nova} />
                      <span className="num text-ink-3">{n0(a.kcal)} kcal</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}

export default function AlimentoPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Content params={params} />
    </Suspense>
  );
}
