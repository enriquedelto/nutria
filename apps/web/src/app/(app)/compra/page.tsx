import { Suspense } from "react";
import Link from "next/link";
import { asc, desc, eq, mealPlans, shoppingItems, storeAccounts, stores } from "@nutria/db";
import { openShoppingList } from "@nutria/core";
import { CATEGORY_NAMES, CATEGORY_ORDER, todayIn } from "@nutria/nutrition";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { kitchenContext } from "@/lib/kitchen";
import { ShoppingClient } from "./shopping-client";

export const metadata = { title: "Compra" };

function mondayOf(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

async function Content() {
  const k = await kitchenContext();
  const list = await openShoppingList(db(), k.groupId);
  const week = mondayOf(todayIn(k.person.timezone));
  const [items, plans, acc, allStores] = await Promise.all([
    db().select().from(shoppingItems).where(eq(shoppingItems.listId, list.id)).orderBy(asc(shoppingItems.sortOrder), asc(shoppingItems.createdAt)),
    db().select({ id: mealPlans.id, weekStart: mealPlans.weekStart }).from(mealPlans).where(eq(mealPlans.groupId, k.groupId)).orderBy(desc(mealPlans.weekStart)).limit(4),
    db().select({ code: stores.code, name: stores.name }).from(storeAccounts).innerJoin(stores, eq(stores.id, storeAccounts.storeId)).where(eq(storeAccounts.groupId, k.groupId)).limit(1),
    db().select({ code: stores.code, name: stores.name, provider: stores.provider }).from(stores),
  ]);
  const plan = plans.find((p) => p.weekStart >= week) ?? plans[0] ?? null;
  const store = acc[0] ?? allStores.find((s) => s.provider) ?? null;
  return (
    <ShoppingClient
      listId={list.id}
      planId={plan?.id ?? null}
      store={store ? { code: store.code, name: store.name } : null}
      categories={CATEGORY_ORDER.map((c) => ({ code: c, name: CATEGORY_NAMES[c] ?? c }))}
      items={items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unit: i.unit, category: CATEGORY_ORDER.includes(i.category) ? i.category : "otros", checked: i.checked, estimatedPrice: i.estimatedPrice != null ? Number(i.estimatedPrice) : null, storeProductId: i.storeProductId }))}
    />
  );
}

export default function CompraPage() {
  return (
    <>
      <PageHeader
        title="Lista de la compra"
        subtitle="Compartida con tu hogar, en tiempo real"
        actions={
          <span className="flex gap-3 text-sm font-medium text-herb">
            <Link href="/compra/tickets">Tickets</Link>
            <Link href="/compra/precios">Precios</Link>
          </span>
        }
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}
