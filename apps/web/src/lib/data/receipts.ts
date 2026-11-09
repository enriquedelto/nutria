import "server-only";
import { and, desc, eq, foods, isNotNull, receiptItems, receipts, sql, stores } from "@nutria/db";
import type { ReceiptReadingMeta } from "@nutria/core";
import { db } from "../db";

export async function listReceipts(groupId: string) {
  return db()
    .select({
      id: receipts.id,
      purchasedOn: receipts.purchasedOn,
      total: receipts.total,
      status: receipts.status,
      openPrices: receipts.openPrices,
      store: stores.name,
      createdAt: receipts.createdAt,
      lines: sql<number>`(select count(*)::int from receipt_items i where i.receipt_id = ${receipts.id})`,
    })
    .from(receipts)
    .leftJoin(stores, eq(stores.id, receipts.storeId))
    .where(eq(receipts.groupId, groupId))
    .orderBy(sql`${receipts.purchasedOn} desc nulls first`, desc(receipts.createdAt))
    .limit(200);
}

export async function receiptDetail(groupId: string, id: string) {
  const [r] = await db().select().from(receipts).where(and(eq(receipts.id, id), eq(receipts.groupId, groupId))).limit(1);
  if (!r) return null;
  const [items, store, used] = await Promise.all([
    db()
      .select({ item: receiptItems, food: { id: foods.id, name: sql<string>`coalesce(${foods.nameEs}, ${foods.name})`, brand: foods.brand, barcode: foods.barcode, quantityLabel: foods.quantityLabel } })
      .from(receiptItems)
      .leftJoin(foods, eq(foods.id, receiptItems.foodId))
      .where(eq(receiptItems.receiptId, r.id))
      .orderBy(receiptItems.line),
    r.storeId ? db().select().from(stores).where(eq(stores.id, r.storeId)).limit(1) : Promise.resolve([]),
    // Stores this household already bought in, to pick one quickly.
    db()
      .selectDistinct({ id: stores.id, name: stores.name, address: stores.address, osmId: stores.osmId })
      .from(receipts)
      .innerJoin(stores, eq(stores.id, receipts.storeId))
      .where(and(eq(receipts.groupId, groupId), isNotNull(receipts.storeId)))
      .limit(30),
  ]);
  const reading = r.reading as unknown as Partial<ReceiptReadingMeta>;
  return {
    receipt: { ...r, total: r.total != null ? Number(r.total) : null },
    reading: { store: reading.store ?? { chain: null, name: null, address: null, city: null, postalCode: null }, candidates: reading.candidates ?? [], cropBottom: reading.cropBottom ?? null, time: reading.time ?? null, confidence: reading.confidence ?? null, aiTotal: reading.aiTotal ?? null },
    store: store[0] ?? null,
    knownStores: used,
    items: items.map(({ item, food }) => ({
      id: item.id,
      rawText: item.rawText,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit as "ud" | "kg" | "l",
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      lineTotal: Number(item.lineTotal),
      discount: item.discount != null ? Number(item.discount) : null,
      foodId: item.foodId,
      matchConfidence: item.matchConfidence,
      priceId: item.priceId,
      food: food?.id ? food : null,
    })),
  };
}
export type ReceiptDetail = NonNullable<Awaited<ReturnType<typeof receiptDetail>>>;

/** /compra/precios: monthly spend, biggest price changes, same food across stores and a basket index. */
export async function priceInsights(groupId: string) {
  const rows = await db()
    .select({ foodId: foods.id, name: sql<string>`coalesce(${foods.nameEs}, ${foods.name})`, brand: foods.brand, store: stores.name, storeId: stores.id, observedOn: sql<string>`p.observed_on`, price: sql<string>`p.price`, perKg: sql<string | null>`p.price_per_kg` })
    .from(sql`prices p`)
    .innerJoin(foods, sql`${foods.id} = p.food_id`)
    .leftJoin(stores, sql`${stores.id} = p.store_id`)
    .where(sql`p.group_id = ${groupId} and p.source = 'receipt'`)
    .orderBy(sql`p.observed_on`);
  const spend = await db()
    .select({ month: sql<string>`to_char(${receipts.purchasedOn}, 'YYYY-MM')`, total: sql<string>`sum(${receipts.total})`, n: sql<number>`count(*)::int` })
    .from(receipts)
    .where(and(eq(receipts.groupId, groupId), eq(receipts.status, "confirmed"), isNotNull(receipts.purchasedOn)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  type Obs = { date: string; value: number; store: string | null; storeId: string | null };
  const byFood = new Map<string, { name: string; brand: string | null; obs: Obs[] }>();
  for (const r of rows) {
    const value = r.perKg != null ? Number(r.perKg) : Number(r.price);
    const f = byFood.get(r.foodId) ?? { name: r.name, brand: r.brand, obs: [] };
    f.obs.push({ date: r.observedOn, value, store: r.store, storeId: r.storeId });
    byFood.set(r.foodId, f);
  }
  const today = new Date().toISOString().slice(0, 10);
  const monthsAgo = (m: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - m);
    return d.toISOString().slice(0, 10);
  };
  const changes = (months: number) =>
    [...byFood.entries()]
      .map(([id, f]) => {
        const recent = f.obs.filter((o) => o.date >= monthsAgo(months));
        if (recent.length < 2) return null;
        const first = recent[0]!;
        const last = recent.at(-1)!;
        if (first.date === last.date || !first.value) return null;
        return { id, name: f.name, brand: f.brand, from: first, to: last, pct: ((last.value - first.value) / first.value) * 100 };
      })
      .filter((x): x is NonNullable<typeof x> => !!x && Math.abs(x.pct) >= 1)
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
      .slice(0, 15);

  // Same food in several stores (latest price in each, last 120 days).
  const acrossStores = [...byFood.entries()]
    .map(([id, f]) => {
      const latest = new Map<string, Obs>();
      for (const o of f.obs) if (o.storeId && o.date >= monthsAgo(4)) latest.set(o.storeId, o);
      const list = [...latest.values()].sort((a, b) => a.value - b.value);
      return list.length >= 2 ? { id, name: f.name, stores: list, saving: ((list.at(-1)!.value - list[0]!.value) / list.at(-1)!.value) * 100 } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.saving - a.saving)
    .slice(0, 15);

  // Basket index: foods bought in at least 3 different months; each month's price vs its first month (median), base 100.
  const monthOf = (d: string) => d.slice(0, 7);
  const habitual = [...byFood.values()].filter((f) => new Set(f.obs.map((o) => monthOf(o.date))).size >= 3);
  const months = [...new Set(habitual.flatMap((f) => f.obs.map((o) => monthOf(o.date))))].sort();
  const basket = months
    .map((m) => {
      const ratios = habitual
        .map((f) => {
          const base = f.obs[0]!.value;
          const inMonth = f.obs.filter((o) => monthOf(o.date) === m);
          return inMonth.length && base ? inMonth.at(-1)!.value / base : null;
        })
        .filter((x): x is number => x != null)
        .sort((a, b) => a - b);
      return ratios.length ? { month: m, index: Math.round(ratios[Math.floor(ratios.length / 2)]! * 1000) / 10, foods: ratios.length } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  return {
    spend: spend.map((s) => ({ month: s.month, total: Number(s.total ?? 0), receipts: s.n })),
    changes3: changes(3),
    changes12: changes(12),
    acrossStores,
    basket,
    habitualCount: habitual.length,
    tracked: byFood.size,
  };
}

