import { ZodError } from "zod";
import { addDiaryItems } from "@/lib/diary-service";
import { getApiUser } from "@/lib/session";

/** Diary insert endpoint used by the offline queue (idempotent by clientId). */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
  try {
    const rows = await addDiaryItems(user.id, await req.json());
    return Response.json({ ids: rows.map((r) => r.id), actionId: rows.actionId }, { status: 201 });
  } catch (e) {
    if (e instanceof ZodError) return Response.json({ error: "Datos no válidos", issues: e.issues }, { status: 400 });
    if (e instanceof Error && e.message.startsWith("Sin permiso")) return Response.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
