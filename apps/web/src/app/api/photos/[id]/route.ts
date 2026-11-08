import { readFile, rm } from "node:fs/promises";
import { z } from "zod";
import { eq, progressPhotos } from "@nutria/db";
import { decryptFile } from "@nutria/integrations";
import { db } from "@/lib/db";
import { HttpError, json, personFor, route } from "@/lib/api";
import { uploadPath } from "@/lib/uploads";

async function load(id: string) {
  const [p] = await db().select().from(progressPhotos).where(eq(progressPhotos.id, z.string().uuid().parse(id))).limit(1);
  if (!p) throw new HttpError(404, "No encontrada");
  return p;
}

export const GET = route<RouteContext<"/api/photos/[id]">>(async (_req, user, ctx) => {
  const p = await load((await ctx.params).id);
  await personFor(user, p.personId, "photos");
  const buf = decryptFile(await readFile(uploadPath(p.storageKey)));
  return new Response(new Uint8Array(buf), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
});

export const DELETE = route<RouteContext<"/api/photos/[id]">>(async (_req, user, ctx) => {
  const p = await load((await ctx.params).id);
  await personFor(user, p.personId, "photos", true);
  await rm(uploadPath(p.storageKey), { force: true });
  await db().delete(progressPhotos).where(eq(progressPhotos.id, p.id));
  return json({ ok: true });
});
