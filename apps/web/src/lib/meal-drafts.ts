import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { and, asc, eq, mealDrafts, type MealDraftPhoto } from "@nutria/db";
import { decryptFile, encryptFile } from "@nutria/integrations";
import { db } from "./db";
import { ImageInput } from "./ai";
import { HttpError } from "./api";
import { uploadPath } from "./uploads";

/** Photos per phase (before / leftovers): enough for a plate from two angles plus a drink. */
export const MAX_PHOTOS_PER_PHASE = 4;

export const DraftImages = z.array(ImageInput.extend({ mediaType: z.literal("image/jpeg"), takenAt: z.string().datetime().nullish() })).max(MAX_PHOTOS_PER_PHASE);

const dir = (personId: string, id: string) => `meal-drafts/${personId}/${id}`;

export type DraftRow = typeof mealDrafts.$inferSelect;

/** Public shape: photos by index (served by /api/meal-drafts/[id]/photos/[n]), never storage keys. */
export const publicDraft = (d: DraftRow) => ({
  id: d.id,
  date: d.date,
  mealSlot: d.mealSlot,
  startedAt: d.startedAt.toISOString(),
  text: d.text,
  status: d.status as "open" | "pending",
  photos: d.photos.map((p, n) => ({ n, phase: p.phase })),
});
export type PublicDraft = ReturnType<typeof publicDraft>;

export async function listDrafts(personId: string) {
  const rows = await db().select().from(mealDrafts).where(eq(mealDrafts.personId, personId)).orderBy(asc(mealDrafts.startedAt));
  return rows.map(publicDraft);
}

/** A meal started at least `minutes` ago and still open: time for the leftovers photo. */
export async function staleOpenDraft(personId: string, minutes = 20) {
  const cutoff = Date.now() - minutes * 60_000;
  return (await listDrafts(personId)).find((d) => d.status === "open" && Date.parse(d.startedAt) < cutoff) ?? null;
}

export async function getDraft(personId: string, id: string) {
  const [d] = await db().select().from(mealDrafts).where(and(eq(mealDrafts.id, z.string().uuid().parse(id)), eq(mealDrafts.personId, personId))).limit(1);
  if (!d) throw new HttpError(404, "Esa comida ya no está");
  return d;
}

/** Encrypts and stores images, returning the photo entries to append. */
async function storePhotos(d: { id: string; personId: string; photos: MealDraftPhoto[] }, images: z.infer<typeof DraftImages>, phase: MealDraftPhoto["phase"]) {
  const have = d.photos.filter((p) => p.phase === phase).length;
  if (have + images.length > MAX_PHOTOS_PER_PHASE) throw new HttpError(400, `Como mucho ${MAX_PHOTOS_PER_PHASE} fotos de ${phase === "before" ? "antes" : "lo que sobró"}`);
  const out: MealDraftPhoto[] = [];
  for (const img of images) {
    const key = `${dir(d.personId, d.id)}/${crypto.randomUUID()}.enc`;
    const path = uploadPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, encryptFile(Buffer.from(img.data, "base64")));
    out.push({ key, phase, takenAt: img.takenAt ?? null });
  }
  return out;
}

export async function createDraft(input: { personId: string; userId: string; date: string; mealSlot: string | null; startedAt: Date; text: string; status: "open" | "pending"; images: z.infer<typeof DraftImages> }) {
  const id = crypto.randomUUID();
  const photos = await storePhotos({ id, personId: input.personId, photos: [] }, input.images, "before");
  const [d] = await db()
    .insert(mealDrafts)
    .values({ id, personId: input.personId, userId: input.userId, date: input.date, mealSlot: input.mealSlot, startedAt: input.startedAt, text: input.text, status: input.status, photos })
    .returning();
  return d!;
}

export async function updateDraft(d: DraftRow, patch: { images?: z.infer<typeof DraftImages>; phase?: MealDraftPhoto["phase"]; text?: string; mealSlot?: string | null; date?: string; startedAt?: Date; status?: "open" | "pending" }) {
  const added = patch.images?.length ? await storePhotos(d, patch.images, patch.phase ?? "after") : [];
  const [u] = await db()
    .update(mealDrafts)
    .set({
      photos: [...d.photos, ...added],
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.mealSlot !== undefined ? { mealSlot: patch.mealSlot } : {}),
      ...(patch.date ? { date: patch.date } : {}),
      ...(patch.startedAt ? { startedAt: patch.startedAt } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(mealDrafts.id, d.id))
    .returning();
  return u!;
}

export async function readPhoto(d: DraftRow, n: number) {
  const p = d.photos[n];
  if (!p) throw new HttpError(404, "Foto no encontrada");
  return decryptFile(await readFile(uploadPath(p.key)));
}

/** Decrypted photos of a phase, ready for the AI. */
export async function draftImages(d: DraftRow, phase: MealDraftPhoto["phase"]) {
  const out: { type: "image"; mediaType: "image/jpeg"; data: string }[] = [];
  for (const p of d.photos.filter((x) => x.phase === phase)) out.push({ type: "image", mediaType: "image/jpeg", data: decryptFile(await readFile(uploadPath(p.key))).toString("base64") });
  return out;
}

export async function deleteDraft(d: { id: string; personId: string }) {
  await rm(uploadPath(dir(d.personId, d.id)), { recursive: true, force: true });
  await db().delete(mealDrafts).where(eq(mealDrafts.id, d.id));
}
