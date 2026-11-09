import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { readReceipt } from "@nutria/ai";
import { createReceiptDraft } from "@nutria/core";
import { encryptFile } from "@nutria/integrations";
import { db } from "@/lib/db";
import { json, route } from "@/lib/api";
import { Images, toImages, withAi } from "@/lib/ai";
import { groupOf } from "@/lib/kitchen";
import { uploadPath } from "@/lib/uploads";

const Body = z.object({ pdf: z.string().max(14_000_000).optional(), images: Images.optional(), listId: z.string().uuid().nullish() });

/**
 * Receipt photo(s) or PDF → AI reading → draft with matched foods and store candidates.
 * Originals are kept encrypted (uploads/receipts/<group>/<id>/n.enc) so the review can show them.
 */
export const POST = route(async (req, user) => {
  const b = Body.parse(await req.json());
  if (!b.pdf && !b.images?.length) return json({ error: "Adjunta una foto o el PDF del ticket" }, 400);
  const { groupId } = await groupOf(user.id);
  const folder = crypto.randomUUID();
  const docs = b.pdf ? [{ data: b.pdf, mime: "application/pdf" }] : b.images!.map((i) => ({ data: i.data, mime: i.mediaType }));
  const files: { key: string; mime: string }[] = [];
  for (const [n, d] of docs.entries()) {
    const key = `receipts/${groupId}/${folder}/${n}.enc`;
    const path = uploadPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, encryptFile(Buffer.from(d.data, "base64")));
    files.push({ key, mime: d.mime });
  }
  return withAi(async () => {
    const out = await readReceipt({ db: db(), userId: user.id, groupId, signal: req.signal }, { pdf: b.pdf, images: b.images ? toImages(b.images) : undefined });
    const id = await createReceiptDraft(db(), {
      groupId,
      userId: user.id,
      estimateId: out.estimateId,
      files,
      shoppingListId: b.listId ?? null,
      date: out.date && /^\d{4}-\d{2}-\d{2}$/.test(out.date) ? out.date : null,
      total: out.total,
      lines: out.items.map((i) => ({ rawText: i.text, name: i.name, quantity: i.quantity > 0 ? i.quantity : 1, unit: i.unit, unitPrice: i.unitPrice, lineTotal: i.total, discount: i.discount, isFood: i.isFood })),
      meta: { store: out.store, time: out.time, cropBottom: b.pdf ? null : out.cropBottom, confidence: out.confidence, aiTotal: out.total },
    });
    return json({ id, lines: out.items.length });
  });
});
