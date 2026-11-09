"use server";
import { UserError } from "@/lib/errors";
import { refresh } from "next/cache";
import { z } from "zod";
import { aiEstimates, and, batches, desc, eq, foods, gt, inArray, pantryItems, prices, recipes, searchFoods, shoppingItems, shoppingLists, sql, storeProductLinks, stores } from "@nutria/db";
import { openShoppingList, shoppingFromPlan } from "@nutria/core";
import { pantryFromPhoto } from "@nutria/ai";
import { aiAction } from "@/lib/ai";
import { STORE_PROVIDERS } from "@nutria/integrations";
import { guessCategory, ingredientKey, parseDateShorthand } from "@nutria/nutrition";
import { publish } from "@/lib/bus";
import { db } from "@/lib/db";
import { addDiaryItems } from "@/lib/diary-service";
import { kitchenGuard } from "@/lib/kitchen";

const uuid = z.string().uuid();
const LOC = z.enum(["nevera", "congelador", "despensa"]);

/* -------------------------------- pantry -------------------------------- */

const PantryIn = z.object({
  name: z.string().trim().min(1).max(120),
  foodId: uuid.nullish(),
  quantity: z.number().min(0).max(100000).default(1),
  unit: z.enum(["g", "ml", "ud"]).default("ud"),
  gramsPerUnit: z.number().min(0).max(10000).nullish(),
  location: LOC.default("despensa"),
  /** ISO date or shorthand (+1m, +10d, 0312, x). */
  expires: z.string().max(20).nullish(),
  staple: z.boolean().default(false),
});

function expiresFrom(v: string | null | undefined): string | null {
  if (!v) return null;
  const r = parseDateShorthand(v);
  if (r === null) throw new UserError("Fecha no válida (usa 2026-12-31, +1m, +10d, 1231…)");
  return r === "never" ? null : r;
}

export async function addPantryItem(input: z.input<typeof PantryIn>) {
  const { groupId } = await kitchenGuard();
  const v = PantryIn.parse(input);
  const expiresOn = expiresFrom(v.expires);
  // Same product, same place and expiry → just add quantity.
  const [same] = await db()
    .select()
    .from(pantryItems)
    .where(and(eq(pantryItems.groupId, groupId), eq(pantryItems.name, v.name), eq(pantryItems.location, v.location), eq(pantryItems.unit, v.unit)))
    .limit(1);
  if (same && same.expiresOn === expiresOn) await db().update(pantryItems).set({ quantity: same.quantity + v.quantity }).where(eq(pantryItems.id, same.id));
  else await db().insert(pantryItems).values({ groupId, name: v.name, foodId: v.foodId ?? null, quantity: v.quantity, unit: v.unit, gramsPerUnit: v.gramsPerUnit ?? null, location: v.location, expiresOn, staple: v.staple });
  refresh();
}

export async function updatePantryItem(id: string, patch: { quantity?: number; location?: string; expires?: string | null; opened?: boolean; staple?: boolean }) {
  const { groupId } = await kitchenGuard();
  const v = z.object({ quantity: z.number().min(0).max(100000).optional(), location: LOC.optional(), expires: z.string().max(20).nullish(), opened: z.boolean().optional(), staple: z.boolean().optional() }).parse(patch);
  const where = and(eq(pantryItems.id, uuid.parse(id)), eq(pantryItems.groupId, groupId));
  if (v.quantity === 0) {
    await db().delete(pantryItems).where(where);
  } else {
    await db()
      .update(pantryItems)
      .set({
        ...(v.quantity != null ? { quantity: v.quantity } : {}),
        ...(v.location ? { location: v.location } : {}),
        ...(v.expires !== undefined ? { expiresOn: expiresFrom(v.expires) } : {}),
        ...(v.opened !== undefined ? { openedOn: v.opened ? new Date().toISOString().slice(0, 10) : null } : {}),
        ...(v.staple !== undefined ? { staple: v.staple } : {}),
      })
      .where(where);
  }
  refresh();
}

export async function deletePantryItem(id: string) {
  const { groupId } = await kitchenGuard();
  await db().delete(pantryItems).where(and(eq(pantryItems.id, uuid.parse(id)), eq(pantryItems.groupId, groupId)));
  refresh();
}

/** Barcode → catalogue food → pantry (unit from the package label when possible). */
export async function pantryFromBarcode(code: string, location: string) {
  const { groupId } = await kitchenGuard();
  const c = z.string().regex(/^\d{6,14}$/).parse(code);
  const [f] = await searchFoods(db(), c, { groupId, limit: 1 });
  if (!f) return { found: false as const };
  const grams = f.quantityLabel ? Number(/(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i.exec(f.quantityLabel)?.[1]?.replace(",", ".")) || null : null;
  await addPantryItem({ name: f.nameEs ?? f.name, foodId: f.id, quantity: 1, unit: "ud", gramsPerUnit: grams, location: LOC.parse(location) });
  return { found: true as const, name: f.nameEs ?? f.name };
}

/** Photo of the fridge/shelf → AI draft of items (confirmed by the user before saving). */
export async function pantryPhotoDraft(images: { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string }[]) {
  const { user, groupId } = await kitchenGuard();
  const imgs = z.array(z.object({ mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().max(8_000_000) })).min(1).max(4).parse(images);
  const r = await aiAction(pantryFromPhoto({ db: db(), userId: user.id, groupId }, imgs.map((i) => ({ type: "image" as const, ...i }))));
  return r;
}

export async function confirmPantryDraft(estimateId: string, items: { name: string; quantity: number; unit: "g" | "ml" | "ud"; location: "nevera" | "congelador" | "despensa"; expiresInDays: number | null }[]) {
  const { user, groupId } = await kitchenGuard();
  const v = z.array(z.object({ name: z.string().trim().min(1).max(120), quantity: z.number().min(0), unit: z.enum(["g", "ml", "ud"]), location: LOC, expiresInDays: z.number().int().min(0).max(3650).nullable() })).max(80).parse(items);
  const today = Date.now();
  if (v.length)
    await db()
      .insert(pantryItems)
      .values(v.map((i) => ({ groupId, name: i.name, quantity: i.quantity || 1, unit: i.unit, location: i.location, expiresOn: i.expiresInDays != null ? new Date(today + i.expiresInDays * 86_400_000).toISOString().slice(0, 10) : null })));
  await db().update(aiEstimates).set({ status: "confirmed", confirmedAt: new Date() }).where(and(eq(aiEstimates.id, uuid.parse(estimateId)), eq(aiEstimates.userId, user.id)));
  refresh();
}

export async function discardBatch(id: string) {
  const { groupId } = await kitchenGuard();
  await db().update(batches).set({ portionsLeft: 0 }).where(and(eq(batches.id, uuid.parse(id)), eq(batches.groupId, groupId)));
  refresh();
}

const EatIn = z.object({
  personId: uuid,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealSlot: z.string().min(1).max(40),
  portions: z.number().min(0.25).max(20).default(1),
});

/** Log portions from a tupper: diary entry with the recipe food, and the batch goes down. */
export async function eatFromBatch(id: string, input: z.input<typeof EatIn>) {
  const { user, groupId } = await kitchenGuard();
  const v = EatIn.parse(input);
  const [b] = await db()
    .select({ id: batches.id, left: batches.portionsLeft, grams: batches.gramsPerPortion, foodId: recipes.foodId, servings: recipes.servings, total: recipes.totalWeightG })
    .from(batches)
    .leftJoin(recipes, eq(recipes.id, batches.recipeId))
    .where(and(eq(batches.id, uuid.parse(id)), eq(batches.groupId, groupId)))
    .limit(1);
  if (!b) throw new UserError("Tupper no encontrado");
  if (b.left <= 0) throw new UserError("Ya no quedan raciones en ese tupper");
  if (!b.foodId) throw new UserError("La receta del tupper ya no existe: regístralo a mano");
  const portions = Math.min(v.portions, b.left);
  const perPortion = b.grams ?? (b.total && b.servings ? b.total / b.servings : 300);
  await addDiaryItems(user.id, { personId: v.personId, date: v.date, mealSlot: v.mealSlot, origin: "batch", items: [{ foodId: b.foodId, grams: Math.round(perPortion * portions), servingLabel: "ración", servingQty: portions }] });
  // Atomic and never below zero, even with two people eating from the same tupper at once.
  await db()
    .update(batches)
    .set({ portionsLeft: sql`greatest(0, ${batches.portionsLeft} - ${portions})` })
    .where(and(eq(batches.id, b.id), gt(batches.portionsLeft, 0)));
  refresh();
  return { portions, left: Math.max(0, b.left - portions) };
}

/* ------------------------------- shopping ------------------------------- */

async function ownList(listId: string, groupId: string) {
  const [l] = await db().select().from(shoppingLists).where(and(eq(shoppingLists.id, uuid.parse(listId)), eq(shoppingLists.groupId, groupId))).limit(1);
  if (!l) throw new UserError("Lista no encontrada");
  return l;
}
const changed = async (listId: string) => {
  await db().update(shoppingLists).set({ updatedAt: new Date() }).where(eq(shoppingLists.id, listId));
  publish(`shopping:${listId}`);
};

export async function addShoppingItem(listId: string, text: string) {
  const { groupId } = await kitchenGuard();
  const l = await ownList(listId, groupId);
  // "2 kg patatas", "leche x3", "6 huevos"
  const t = z.string().trim().min(1).max(160).parse(text);
  const m = /^(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|ud|uds|paquetes?|latas?|botellas?|bricks?)?\s+(.+)$/i.exec(t) ?? /^(.+?)\s+x\s*(\d+)$/i.exec(t);
  let name = t,
    quantity: number | null = null,
    unit: string | null = null;
  if (m && /^\d/.test(m[1]!)) {
    quantity = Number(m[1]!.replace(",", "."));
    unit = m[2]?.toLowerCase() ?? null;
    name = m[3]!;
  } else if (m) {
    name = m[1]!;
    quantity = Number(m[2]);
  }
  if (unit === "kg") [quantity, unit] = [quantity! * 1000, "g"];
  if (unit === "l") [quantity, unit] = [quantity! * 1000, "ml"];
  await db().insert(shoppingItems).values({ listId: l.id, name: name.slice(0, 120), quantity, unit, category: guessCategory(name) });
  await changed(l.id);
  refresh();
}

export async function toggleShoppingItem(id: string, checked: boolean) {
  const { user, groupId } = await kitchenGuard();
  const [it] = await db().select({ id: shoppingItems.id, listId: shoppingItems.listId }).from(shoppingItems).innerJoin(shoppingLists, eq(shoppingLists.id, shoppingItems.listId)).where(and(eq(shoppingItems.id, uuid.parse(id)), eq(shoppingLists.groupId, groupId))).limit(1);
  if (!it) throw new UserError("No encontrado");
  await db().update(shoppingItems).set({ checked, checkedBy: checked ? user.id : null }).where(eq(shoppingItems.id, it.id));
  await changed(it.listId);
}

export async function deleteShoppingItem(id: string) {
  const { groupId } = await kitchenGuard();
  const [it] = await db().select({ id: shoppingItems.id, listId: shoppingItems.listId }).from(shoppingItems).innerJoin(shoppingLists, eq(shoppingLists.id, shoppingItems.listId)).where(and(eq(shoppingItems.id, uuid.parse(id)), eq(shoppingLists.groupId, groupId))).limit(1);
  if (!it) return;
  await db().delete(shoppingItems).where(eq(shoppingItems.id, it.id));
  await changed(it.listId);
  refresh();
}

/** Finish shopping: checked items go to the pantry, the list is closed and a new one opened with the rest. */
export async function finishShopping(listId: string, toPantry: boolean) {
  const { groupId } = await kitchenGuard();
  const l = await ownList(listId, groupId);
  const items = await db().select().from(shoppingItems).where(eq(shoppingItems.listId, l.id));
  const bought = items.filter((i) => i.checked);
  const rest = items.filter((i) => !i.checked);
  if (toPantry && bought.length)
    await db()
      .insert(pantryItems)
      .values(bought.map((i) => ({ groupId, foodId: i.foodId, name: i.name, quantity: i.quantity ?? 1, unit: i.unit === "g" || i.unit === "ml" ? i.unit : "ud", location: /lacteos|carne|pescado|fruta/.test(i.category) ? "nevera" : i.category === "congelados" ? "congelador" : "despensa" })));
  await db().update(shoppingLists).set({ status: "done" }).where(eq(shoppingLists.id, l.id));
  const next = await openShoppingList(db(), groupId);
  if (rest.length) await db().update(shoppingItems).set({ listId: next.id }).where(inArray(shoppingItems.id, rest.map((i) => i.id)));
  publish(`shopping:${l.id}`, { closed: true, next: next.id });
  refresh();
  return { bought: bought.length, moved: rest.length };
}

export async function shoppingFromPlanAction(planId: string) {
  const { groupId } = await kitchenGuard();
  const r = await shoppingFromPlan(db(), { groupId, planId: uuid.parse(planId) });
  publish(`shopping:${r.listId}`);
  refresh();
  return r;
}

/** Restock staples marked in the pantry that ran out. */
export async function addStaplesToList(listId: string) {
  const { groupId } = await kitchenGuard();
  const l = await ownList(listId, groupId);
  const staples = await db().select().from(pantryItems).where(and(eq(pantryItems.groupId, groupId), eq(pantryItems.staple, true)));
  const low = staples.filter((s) => s.quantity <= (s.unit === "ud" ? 1 : 100));
  const existing = new Set((await db().select({ name: shoppingItems.name }).from(shoppingItems).where(and(eq(shoppingItems.listId, l.id), eq(shoppingItems.checked, false)))).map((x) => ingredientKey(x.name)));
  const add = low.filter((s) => !existing.has(ingredientKey(s.name)));
  if (add.length) await db().insert(shoppingItems).values(add.map((s) => ({ listId: l.id, foodId: s.foodId, name: s.name, category: guessCategory(s.name) })));
  await changed(l.id);
  refresh();
  return add.length;
}

/* --------------------------- store & prices --------------------------- */

export async function searchStoreProducts(storeCode: string, q: string) {
  await kitchenGuard();
  const query = z.string().trim().min(2).max(80).parse(q);
  const rows = await searchFoods(db(), query, { sources: ["store"], limit: 12 });
  const own = rows.filter((r) => r.sourceId?.startsWith(`${storeCode}:`));
  const ids = own.map((r) => r.id);
  const pr = ids.length ? await db().selectDistinctOn([prices.foodId], { foodId: prices.foodId, price: prices.price, perKg: prices.pricePerKg }).from(prices).where(inArray(prices.foodId, ids)).orderBy(prices.foodId, desc(prices.observedOn)) : [];
  const pm = new Map(pr.map((p) => [p.foodId, p]));
  return own.map((r) => ({ foodId: r.id, productId: r.sourceId!.split(":")[1]!, name: r.name, pack: r.quantityLabel, imageUrl: r.imageUrl, price: pm.get(r.id) ? Number(pm.get(r.id)!.price) : null, perKg: pm.get(r.id)?.perKg ? Number(pm.get(r.id)!.perKg) : null }));
}

/** Link a shopping line (and its ingredient, for next time) to a store product. */
export async function linkStoreProduct(itemId: string, storeCode: string, product: { productId: string; name: string; pack?: string | null; price?: number | null }) {
  const { groupId } = await kitchenGuard();
  const [it] = await db().select({ item: shoppingItems }).from(shoppingItems).innerJoin(shoppingLists, eq(shoppingLists.id, shoppingItems.listId)).where(and(eq(shoppingItems.id, uuid.parse(itemId)), eq(shoppingLists.groupId, groupId))).limit(1);
  if (!it) throw new UserError("No encontrado");
  const [store] = await db().select().from(stores).where(eq(stores.code, storeCode)).limit(1);
  if (!store) throw new UserError("Tienda no configurada");
  const p = z.object({ productId: z.string().max(40), name: z.string().max(200), pack: z.string().max(60).nullish(), price: z.number().min(0).max(10000).nullish() }).parse(product);
  await db().update(shoppingItems).set({ storeProductId: `${storeCode}:${p.productId}`, estimatedPrice: p.price != null ? p.price.toFixed(2) : null }).where(eq(shoppingItems.id, it.item.id));
  const key = ingredientKey(it.item.name);
  await db().delete(storeProductLinks).where(and(eq(storeProductLinks.groupId, groupId), eq(storeProductLinks.storeId, store.id), eq(storeProductLinks.ingredientKey, key)));
  await db().insert(storeProductLinks).values({ groupId, storeId: store.id, foodId: it.item.foodId, ingredientKey: key, productId: p.productId, productName: p.name, packSize: p.pack ?? null });
  await changed(it.item.listId);
  refresh();
}

/** Apply remembered product links to unlinked lines. */
export async function autoLinkProducts(listId: string, storeCode: string) {
  const { groupId } = await kitchenGuard();
  const l = await ownList(listId, groupId);
  const [store] = await db().select().from(stores).where(eq(stores.code, storeCode)).limit(1);
  if (!store) return 0;
  const [items, links] = await Promise.all([
    db().select().from(shoppingItems).where(and(eq(shoppingItems.listId, l.id), eq(shoppingItems.checked, false))),
    db().select().from(storeProductLinks).where(and(eq(storeProductLinks.groupId, groupId), eq(storeProductLinks.storeId, store.id))),
  ]);
  let n = 0;
  for (const it of items.filter((i) => !i.storeProductId)) {
    const link = links.find((x) => (it.foodId && x.foodId === it.foodId) || x.ingredientKey === ingredientKey(it.name));
    if (!link) continue;
    const [f] = await db().select({ id: foods.id }).from(foods).where(eq(foods.sourceId, `${storeCode}:${link.productId}`)).limit(1);
    const [pr] = f ? await db().select({ price: prices.price }).from(prices).where(eq(prices.foodId, f.id)).orderBy(desc(prices.observedOn)).limit(1) : [];
    await db().update(shoppingItems).set({ storeProductId: `${storeCode}:${link.productId}`, estimatedPrice: pr?.price ?? null }).where(eq(shoppingItems.id, it.id));
    n++;
  }
  if (n) await changed(l.id);
  refresh();
  return n;
}

/** Send linked lines to the store (cart API or ordered product links). Payment always on the store's site. */
export async function sendToStore(listId: string, storeCode: string) {
  const { groupId } = await kitchenGuard();
  const l = await ownList(listId, groupId);
  const make = STORE_PROVIDERS[storeCode];
  if (!make) throw new UserError("Tienda no soportada");
  const items = await db().select().from(shoppingItems).where(and(eq(shoppingItems.listId, l.id), eq(shoppingItems.checked, false)));
  const lines = items.filter((i) => i.storeProductId?.startsWith(`${storeCode}:`)).map((i) => ({ productId: i.storeProductId!.split(":")[1]!, quantity: i.unit === "ud" || !i.unit ? Math.max(1, Math.round(i.quantity ?? 1)) : 1 }));
  const r = await make().toCart(lines);
  return { ...r, names: Object.fromEntries(items.filter((i) => i.storeProductId).map((i) => [i.storeProductId!.split(":")[1]!, i.name])), unlinked: items.filter((i) => !i.storeProductId).length };
}

/** "A la compra" from a food page: adds it to the open shopping list (creates one if needed). */
export async function addFoodToShopping(foodId: string) {
  const { groupId } = await kitchenGuard();
  const [f] = await db()
    .select({ id: foods.id, name: foods.name, nameEs: foods.nameEs })
    .from(foods)
    .where(and(eq(foods.id, uuid.parse(foodId)), sql`(${foods.groupId} is null or ${foods.groupId} = ${groupId})`))
    .limit(1);
  if (!f) throw new UserError("Alimento no encontrado");
  const l = await openShoppingList(db(), groupId);
  const name = (f.nameEs ?? f.name).slice(0, 120);
  await db().insert(shoppingItems).values({ listId: l.id, foodId: f.id, name, category: guessCategory(name) });
  await changed(l.id);
  refresh();
  return name;
}
