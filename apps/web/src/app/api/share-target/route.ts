import { getApiUser } from "@/lib/session";
import { saveShare } from "@/lib/uploads";

const URL_RE = /https?:\/\/[^\s]+/i;

/**
 * Web Share Target (manifest): photos → AI meal logging; recipe/video URLs → recipe import;
 * plain text → AI meal logging with the text prefilled.
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  // Relative Location: req.url carries the internal host behind Docker/Caddy.
  const to = (path: string) => new Response(null, { status: 303, headers: { Location: path } });
  if (!user) return to("/login?next=/registrar");
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0 && f.size < 20 * 1024 * 1024);
  if (files.length) {
    const id = crypto.randomUUID();
    await saveShare(user.id, id, files);
    return to(`/registrar?compartido=${id}`);
  }
  const text = [form.get("title"), form.get("text"), form.get("url")].filter((x): x is string => typeof x === "string" && !!x).join(" ");
  const url = text.match(URL_RE)?.[0];
  if (url) return to(`/recetas/importar?url=${encodeURIComponent(url)}`);
  return to(`/registrar?texto=${encodeURIComponent(text.slice(0, 1000))}`);
}
