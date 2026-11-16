import { z } from "zod";
import { eq, persons } from "@nutria/db";
import { quickLog } from "@nutria/core";
import { db } from "@/lib/db";
import { assertAccess, getApiUser } from "@/lib/session";

const In = z.object({
  kind: z.enum(["usual", "yesterday", "shake", "day_complete"]),
  slot: z.string().max(40).nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

/**
 * One-tap logging for the user's own person, without opening the app: notification actions
 * («Lo de siempre», «Registrar batido», «Completo») and app shortcuts. Always answers { ok, message }.
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ ok: false, message: "Abre Nutria e inicia sesión" }, { status: 401 });
  const body = In.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, message: "Petición no válida" }, { status: 400 });
  const [me] = await db().select({ id: persons.id }).from(persons).where(eq(persons.userId, user.id)).limit(1);
  if (!me) return Response.json({ ok: false, message: "Sin perfil propio" }, { status: 404 });
  await assertAccess(user.id, me.id, "diary", true);
  return Response.json(await quickLog(db(), { personId: me.id, userId: user.id, kind: body.data.kind, slot: body.data.slot ?? null, date: body.data.date ?? null }));
}
