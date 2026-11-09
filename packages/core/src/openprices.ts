import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq, foods, integrationAccounts, isNull, receiptItems, receipts, stores, type Database, type ReceiptOpenPrices } from "@nutria/db";
import { decrypt, decryptFile, encrypt, openPricesAddPrice, openPricesLogin, openPricesUploadReceipt, OpenPricesError, openPricesWriteBase } from "@nutria/integrations";
import { uploadDir } from "./dataio";

export const OPEN_PRICES = "open_prices";

/** The user's Open Prices connection (token encrypted at rest; the password is never stored). */
export async function openPricesAccount(db: Database, userId: string) {
  const [a] = await db
    .select()
    .from(integrationAccounts)
    .where(and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.provider, OPEN_PRICES), isNull(integrationAccounts.personId)))
    .orderBy(desc(integrationAccounts.createdAt))
    .limit(1);
  return a ?? null;
}

export async function connectOpenPrices(db: Database, userId: string, username: string, password: string, f: typeof fetch = fetch) {
  const token = await openPricesLogin(username, password, f);
  await db.delete(integrationAccounts).where(and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.provider, OPEN_PRICES)));
  const [a] = await db
    .insert(integrationAccounts)
    .values({ userId, provider: OPEN_PRICES, baseUrl: openPricesWriteBase(), credentialsEnc: encrypt(token), status: "active", meta: { username } })
    .returning();
  return a!;
}

/**
 * Upload the approved (cropped) receipt image as proof and one price per line with a barcode.
 * Lines sold by weight without barcode would need an OFF category tag: they are skipped for now.
 */
export async function shareReceipt(db: Database, receiptId: string, f: typeof fetch = fetch): Promise<ReceiptOpenPrices> {
  const [r] = await db.select().from(receipts).where(eq(receipts.id, receiptId)).limit(1);
  if (!r) throw new Error("Ticket no encontrado");
  if (r.openPrices?.status === "shared") return r.openPrices;
  const save = async (op: ReceiptOpenPrices) => {
    await db.update(receipts).set({ openPrices: op, updatedAt: new Date() }).where(eq(receipts.id, r.id));
    return op;
  };
  const fail = (error: string) => save({ status: "error", error });
  if (!r.shareKey) return fail("No hay imagen aprobada para compartir");
  if (!r.userId || !r.purchasedOn) return fail("Faltan datos del ticket");
  const acc = await openPricesAccount(db, r.userId);
  if (!acc?.credentialsEnc || acc.status !== "active") return fail("Conecta tu cuenta de Open Prices en Ajustes › Integraciones");
  const [store] = r.storeId ? await db.select().from(stores).where(eq(stores.id, r.storeId)).limit(1) : [];
  if (!store?.osmId || !store.osmType) return fail("La tienda no tiene ubicación en OpenStreetMap");
  const lines = await db
    .select({ quantity: receiptItems.quantity, unit: receiptItems.unit, lineTotal: receiptItems.lineTotal, discount: receiptItems.discount, barcode: foods.barcode })
    .from(receiptItems)
    .leftJoin(foods, eq(foods.id, receiptItems.foodId))
    .where(eq(receiptItems.receiptId, r.id));
  const priceable = lines.filter((l) => l.unit === "ud" && l.barcode && /^\d{8,14}$/.test(l.barcode) && Number(l.lineTotal) > 0 && l.quantity > 0);
  const token = decrypt(acc.credentialsEnc);
  const meta = { osmId: store.osmId, osmType: store.osmType, date: r.purchasedOn, currency: r.currency };
  try {
    const image = decryptFile(await readFile(join(uploadDir(), r.shareKey)));
    const proofId = await openPricesUploadReceipt(token, { data: image, mime: "image/jpeg" }, { ...meta, priceCount: priceable.length, total: r.total != null ? Number(r.total) : null }, f);
    let ok = 0;
    for (const l of priceable) {
      const each = Number(l.lineTotal) / l.quantity;
      const disc = l.discount ? Number(l.discount) / l.quantity : 0;
      try {
        await openPricesAddPrice(token, proofId, meta, { productCode: l.barcode!, price: each, discounted: disc > 0, priceWithoutDiscount: disc > 0 ? each + disc : null, quantity: l.quantity }, f);
        ok++;
      } catch {
        /* one bad line (unknown product…) must not stop the rest */
      }
    }
    await rm(join(uploadDir(), r.shareKey), { force: true });
    await db.update(receipts).set({ shareKey: null }).where(eq(receipts.id, r.id));
    return save({ status: "shared", proofId, prices: ok, skipped: lines.length - ok, sharedAt: new Date().toISOString() });
  } catch (e) {
    if (e instanceof OpenPricesError && e.status === 401) {
      await db.update(integrationAccounts).set({ status: "error", lastError: "Sesión caducada" }).where(eq(integrationAccounts.id, acc.id));
      return fail("La sesión de Open Prices ha caducado: vuelve a conectar la cuenta");
    }
    return fail(e instanceof Error ? e.message.slice(0, 300) : "Error al compartir");
  }
}
