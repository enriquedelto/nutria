import { readFile } from "node:fs/promises";
import { z } from "zod";
import { and, eq, receipts } from "@nutria/db";
import { decryptFile } from "@nutria/integrations";
import { db } from "@/lib/db";
import { HttpError, route } from "@/lib/api";
import { groupOf } from "@/lib/kitchen";
import { uploadPath } from "@/lib/uploads";

/** GET /api/receipts/:id/file/:n — decrypted original (household only). */
export const GET = route<{ params: Promise<{ id: string; n: string }> }>(async (_req, user, ctx) => {
  const { id, n } = await ctx.params;
  const { groupId } = await groupOf(user.id);
  const [r] = await db().select({ files: receipts.files }).from(receipts).where(and(eq(receipts.id, z.string().uuid().parse(id)), eq(receipts.groupId, groupId))).limit(1);
  const f = r?.files[z.coerce.number().int().min(0).max(10).parse(n)];
  if (!f) throw new HttpError(404, "No encontrado");
  const buf = decryptFile(await readFile(uploadPath(f.key)));
  return new Response(new Uint8Array(buf), { headers: { "content-type": f.mime, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
});
