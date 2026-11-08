import "server-only";
import { ZodError } from "zod";
import { eq, getPersonAccess, persons, type AccessScope } from "@nutria/db";
import { db } from "./db";
import { UserError } from "./errors";
import { getApiUser, type CurrentUser } from "./session";

export class HttpError extends UserError {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (data: unknown, init?: number | ResponseInit) => Response.json(data, typeof init === "number" ? { status: init } : init);

/** Wraps a route handler: auth, consistent JSON errors, no stack traces leaked. */
export function route<C = unknown>(fn: (req: Request, user: CurrentUser, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      const user = await getApiUser(req);
      if (!user) return json({ error: "No autenticado" }, 401);
      return await fn(req, user, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof ZodError) return json({ error: "Datos no válidos", issues: e.issues }, 400);
      if (e instanceof Error && e.message.startsWith("Sin permiso")) return json({ error: e.message }, 403);
      if (e instanceof UserError) return json({ error: e.message }, 400);
      console.error(JSON.stringify({ svc: "web", msg: "route error", path: new URL(req.url).pathname, requestId: req.headers.get("x-request-id"), error: e instanceof Error ? e.message : String(e) }));
      return json({ error: "Error interno" }, 500);
    }
  };
}

/** Person from ?personId= (or body) with scope check; returns its group for catalogue visibility. */
export async function personFor(user: CurrentUser, personId: string | null, scope: AccessScope, write = false) {
  if (!personId) throw new HttpError(400, "Falta personId");
  const access = await getPersonAccess(db(), user.id, personId);
  if (!access || !access.scopes.has(scope) || (write && !access.canWrite)) throw new HttpError(403, "Sin permiso para esta persona");
  const [p] = await db().select().from(persons).where(eq(persons.id, personId)).limit(1);
  if (!p) throw new HttpError(404, "Persona no encontrada");
  return { person: p, access };
}
