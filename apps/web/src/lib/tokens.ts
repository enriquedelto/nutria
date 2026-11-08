import "server-only";
import { and, apiTokens, eq, getPersonAccess, isNull, persons, user, type AccessScope } from "@nutria/db";
import { sha256 } from "@nutria/integrations";
import { HttpError } from "./api";
import { db } from "./db";

export type TokenScope = "read" | "write" | "destroy";
export type TokenAuth = { tokenId: string; userId: string; userName: string; scopes: Set<TokenScope> };

/** Bearer personal token → owner + scopes. Throws HttpError(401/403). */
export async function tokenAuth(req: Request, need: TokenScope = "read"): Promise<TokenAuth> {
  const h = req.headers.get("authorization") ?? "";
  const raw = /^Bearer\s+(\S+)$/i.exec(h)?.[1];
  if (!raw) throw new HttpError(401, "Falta el token (Authorization: Bearer …)");
  const [t] = await db()
    .select({ id: apiTokens.id, userId: apiTokens.userId, scopes: apiTokens.scopes, expiresAt: apiTokens.expiresAt, lastUsedAt: apiTokens.lastUsedAt, name: user.name })
    .from(apiTokens)
    .innerJoin(user, eq(user.id, apiTokens.userId))
    .where(and(eq(apiTokens.tokenHash, sha256(raw)), isNull(apiTokens.revokedAt)))
    .limit(1);
  if (!t || (t.expiresAt && t.expiresAt < new Date())) throw new HttpError(401, "Token no válido o caducado");
  const scopes = new Set(t.scopes as TokenScope[]);
  if (!scopes.has(need)) throw new HttpError(403, `El token no tiene permiso «${need}»`);
  // Throttle lastUsedAt writes to once per minute.
  if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > 60_000) void db().update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, t.id)).catch(() => undefined);
  return { tokenId: t.id, userId: t.userId, userName: t.name, scopes };
}

/** Resolve the target person for a token call: explicit id (checked) or the user's own person. */
export async function tokenPerson(auth: TokenAuth, personId: string | null | undefined, scope: AccessScope, write = false) {
  const id =
    personId ??
    (await db().select({ id: persons.id }).from(persons).where(eq(persons.userId, auth.userId)).limit(1))[0]?.id;
  if (!id) throw new HttpError(404, "Persona no encontrada");
  const access = await getPersonAccess(db(), auth.userId, id);
  if (!access || !access.scopes.has(scope) || (write && !access.canWrite)) throw new HttpError(403, "Sin permiso para esta persona");
  const [p] = await db().select().from(persons).where(eq(persons.id, id)).limit(1);
  return { person: p!, access };
}

/** Route wrapper for token-authenticated (non-session) endpoints with JSON errors. */
export function publicRoute<C = unknown>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof Error && e.name === "ZodError") return Response.json({ error: "Datos no válidos" }, { status: 400 });
      console.error(JSON.stringify({ svc: "web", msg: "public route error", path: new URL(req.url).pathname, error: e instanceof Error ? e.message : String(e) }));
      return Response.json({ error: "Error interno" }, { status: 500 });
    }
  };
}
