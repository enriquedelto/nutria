import { readFile } from "node:fs/promises";
import { getApiUser } from "@/lib/session";
import { mimeOf, readShareMeta, uploadPath } from "@/lib/uploads";

/** Shared files are only readable by the user who shared them. */
export async function GET(req: Request, ctx: RouteContext<"/api/share-target/[id]/[file]">) {
  const user = await getApiUser(req);
  const { id, file } = await ctx.params;
  if (!user || !/^[0-9a-f-]{36}$/.test(id)) return new Response("No encontrado", { status: 404 });
  const meta = await readShareMeta(id);
  if (!meta || meta.userId !== user.id || !meta.names.includes(file)) return new Response("No encontrado", { status: 404 });
  return new Response(await readFile(uploadPath("share", id, file)), { headers: { "content-type": mimeOf(file), "cache-control": "private, max-age=3600" } });
}
