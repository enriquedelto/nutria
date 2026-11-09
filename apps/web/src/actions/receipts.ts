"use server";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { refresh } from "next/cache";
import { z } from "zod";
import { and, eq, receipts } from "@nutria/db";
import { confirmReceipt, connectOpenPrices, openPricesAccount, type StoreChoice } from "@nutria/core";
import { encryptFile, OpenPricesError } from "@nutria/integrations";
import { db } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { enqueue } from "@/lib/jobs";
import { kitchenGuard } from "@/lib/kitchen";
import { uploadPath } from "@/lib/uploads";

const uuid = z.string().uuid();
const money = z.number().min(-10_000).max(10_000);

const Place = z.object({ osmId: z.number().int().positive(), osmType: z.enum(["NODE", "WAY", "RELATION"]), name: z.string().max(200), displayName: z.string().max(400), lat: z.number(), lon: z.number() });
const Store = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), storeId: uuid }),
  z.object({ kind: z.literal("osm"), place: Place }),
  z.object({ kind: z.literal("manual"), name: z.string().trim().min(1).max(120) }),
  z.object({ kind: z.literal("none") }),
]);
const Line = z.object({
  rawText: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(160),
  quantity: z.number().positive().max(1000),
  unit: z.enum(["ud", "kg", "l"]),
  unitPrice: money.nullable(),
  lineTotal: money,
  discount: money.nullable(),
  foodId: uuid.nullable(),
  matchConfidence: z.number().min(0).max(1).nullish(),
});
const Confirm = z.object({
  store: Store,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total: money.nullable(),
  lines: z.array(Line).max(150),
  toPantry: z.boolean(),
  /** Cropped JPEG (base64) the user approved for Open Prices; omitted = not shared. */
  shareImage: z.string().max(8_000_000).nullish(),
});

/** Save the reviewed receipt; with an approved image, queue the Open Prices upload. */
export async function confirmReceiptAction(receiptId: string, input: z.input<typeof Confirm>) {
  const { user, groupId } = await kitchenGuard();
  const v = Confirm.parse(input);
  const id = uuid.parse(receiptId);
  let shareKey: string | null = null;
  if (v.shareImage) {
    const acc = await openPricesAccount(db(), user.id);
    if (acc?.status !== "active") throw new UserError("Conecta tu cuenta de Open Prices en Ajustes › Integraciones para compartir");
    if (v.store.kind !== "osm" && v.store.kind !== "existing") throw new UserError("Para compartir, elige la tienda en el mapa (OpenStreetMap)");
    shareKey = `receipts/${groupId}/share/${id}.enc`;
    const path = uploadPath(shareKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, encryptFile(Buffer.from(v.shareImage, "base64")));
  }
  const out = await confirmReceipt(db(), { receiptId: id, groupId, store: v.store as StoreChoice, date: v.date, total: v.total, lines: v.lines, toPantry: v.toPantry, shareKey }).catch((e: Error) => {
    throw new UserError(e.message);
  });
  if (out.share) await enqueue("openprices.share", { receiptId: id }, { singletonKey: `op:${id}` });
  refresh();
  return out;
}

export async function retryReceiptShare(receiptId: string) {
  const { groupId } = await kitchenGuard();
  const [r] = await db().select({ id: receipts.id, shareKey: receipts.shareKey }).from(receipts).where(and(eq(receipts.id, uuid.parse(receiptId)), eq(receipts.groupId, groupId))).limit(1);
  if (!r?.shareKey) throw new UserError("No hay imagen pendiente de compartir");
  await db().update(receipts).set({ openPrices: { status: "pending" } }).where(eq(receipts.id, r.id));
  await enqueue("openprices.share", { receiptId: r.id }, { singletonKey: `op:${r.id}` });
  refresh();
}

/** Delete a receipt with its images and the prices it created (ON DELETE CASCADE). */
export async function deleteReceipt(receiptId: string) {
  const { groupId } = await kitchenGuard();
  const [r] = await db().select().from(receipts).where(and(eq(receipts.id, uuid.parse(receiptId)), eq(receipts.groupId, groupId))).limit(1);
  if (!r) throw new UserError("Ticket no encontrado");
  for (const f of r.files) await rm(uploadPath(f.key), { force: true });
  if (r.shareKey) await rm(uploadPath(r.shareKey), { force: true });
  await db().delete(receipts).where(eq(receipts.id, r.id));
  refresh();
}

/** Open Food Facts user id + password → Open Prices token (only the token is stored, encrypted). */
export async function connectOpenPricesAction(username: string, password: string) {
  const { user } = await kitchenGuard();
  const u = z.string().trim().min(1).max(100).parse(username);
  const p = z.string().min(1).max(200).parse(password);
  try {
    await connectOpenPrices(db(), user.id, u, p);
  } catch (e) {
    if (e instanceof OpenPricesError && (e.status === 401 || e.status === 403 || e.status === 422)) throw new UserError("Usuario o contraseña de Open Food Facts incorrectos");
    throw new UserError("No se pudo conectar con Open Prices; inténtalo más tarde");
  }
  refresh();
}
