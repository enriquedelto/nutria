import "server-only";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { uploadDir } from "@nutria/core";

/** Path inside the upload volume; rejects traversal. */
export function uploadPath(...parts: string[]) {
  const base = normalize(uploadDir());
  const p = normalize(join(base, ...parts));
  if (!p.startsWith(base)) throw new Error("Ruta no válida");
  return p;
}

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", pdf: "application/pdf", enc: "application/octet-stream" };
export const mimeOf = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export async function saveShare(userId: string, id: string, files: File[]) {
  const dir = uploadPath("share", id);
  await mkdir(dir, { recursive: true });
  const names: string[] = [];
  for (const [i, f] of files.slice(0, 6).entries()) {
    const ext = (f.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
    const name = `${i}.${ext}`;
    await writeFile(join(dir, name), Buffer.from(await f.arrayBuffer()));
    names.push(name);
  }
  await writeFile(join(dir, "meta.json"), JSON.stringify({ userId, names, at: Date.now() }));
  return names;
}

export async function readShareMeta(id: string): Promise<{ userId: string; names: string[] } | null> {
  try {
    return JSON.parse(await readFile(uploadPath("share", id, "meta.json"), "utf8"));
  } catch {
    return null;
  }
}

export async function listDir(...parts: string[]) {
  try {
    return await readdir(uploadPath(...parts));
  } catch {
    return [];
  }
}
