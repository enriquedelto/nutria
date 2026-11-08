import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { importPath } from "@nutria/core";
import { imports } from "@nutria/db";
import { db } from "@/lib/db";
import { HttpError, json, personFor, route } from "@/lib/api";
import { enqueue } from "@/lib/jobs";

/** Upload a diary CSV (MyFitnessPal, Lose It, Cronometer, Waistline or generic); processed by the worker. */
export const POST = route(async (req, user) => {
  const form = await req.formData();
  const { person } = await personFor(user, String(form.get("personId") ?? ""), "diary", true);
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new HttpError(400, "Adjunta un CSV");
  if (file.size > 20 * 1024 * 1024) throw new HttpError(413, "Archivo demasiado grande (máx. 20 MB)");
  const text = await file.text();
  if (!text.includes(",") && !text.includes(";")) throw new HttpError(400, "No parece un CSV");
  const [row] = await db()
    .insert(imports)
    .values({ userId: user.id, personId: person.id, source: "auto", status: "pending", fileName: file instanceof File ? file.name.slice(0, 120) : null })
    .returning();
  const path = importPath(row!.id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
  await enqueue("import.diary", { importId: row!.id });
  return json(row, 201);
});
