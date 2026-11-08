import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { progressPhotos } from "@nutria/db";
import { encryptFile } from "@nutria/integrations";
import { db } from "@/lib/db";
import { HttpError, json, personFor, route } from "@/lib/api";
import { uploadPath } from "@/lib/uploads";

/** Progress photo upload: AES-GCM encrypted at rest, private (scope "photos"). */
export const POST = route(async (req, user) => {
  const form = await req.formData();
  const { person } = await personFor(user, String(form.get("personId") ?? ""), "photos", true);
  const file = form.get("file");
  if (!(file instanceof Blob) || !file.type.startsWith("image/")) throw new HttpError(400, "Adjunta una imagen");
  if (file.size > 12 * 1024 * 1024) throw new HttpError(413, "Imagen demasiado grande");
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(form.get("date"));
  const pose = z.enum(["front", "side", "back", "other"]).parse(form.get("pose") ?? "front");
  const id = crypto.randomUUID();
  const key = `photos/${person.id}/${id}.enc`;
  const path = uploadPath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, encryptFile(Buffer.from(await file.arrayBuffer())));
  const [row] = await db().insert(progressPhotos).values({ id, personId: person.id, date, pose, storageKey: key }).returning();
  return json(row, 201);
});
