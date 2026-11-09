import "server-only";
import { z } from "zod";
import { AiError, type PersonFeatureCtx } from "@nutria/ai";
import { db } from "./db";
import { HttpError, json, personFor } from "./api";
import type { CurrentUser } from "./session";
import type { AccessScope } from "@nutria/db";
import { UserError } from "./errors";

export const ImageInput = z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  data: z.string().max(8_000_000), // base64 (~6 MB)
});
export const Images = z.array(ImageInput).max(6);

export const toImages = (xs: z.infer<typeof Images>) => xs.map((i) => ({ type: "image" as const, mediaType: i.mediaType, data: i.data }));

/** Person-scoped AI context; the `ai` scope is required on top of the data scope. */
export async function aiCtx(user: CurrentUser, personId: string | null | undefined, scope: AccessScope, req?: Request): Promise<PersonFeatureCtx & { groupId: string | null; timezone: string }> {
  const { person, access } = await personFor(user, personId ?? null, scope);
  if (!access.scopes.has("ai")) throw new HttpError(403, "Sin permiso de IA para esta persona");
  return { db: db(), userId: user.id, personId: person.id, scopes: access.scopes, signal: req?.signal, groupId: person.groupId, timezone: person.timezone };
}

const STATUS: Record<AiError["code"], number> = { quota: 429, rate_limit: 503, overloaded: 503, refusal: 422, invalid_output: 502, auth: 503, aborted: 499, unknown: 502 };
const MESSAGE: Record<AiError["code"], string> = {
  quota: "Has llegado al límite de uso de IA por hoy.",
  rate_limit: "La IA ha llegado al límite de uso de la suscripción. Prueba dentro de un rato; el resto de la app funciona con normalidad.",
  overloaded: "La IA está saturada ahora mismo; prueba en un minuto.",
  refusal: "La IA no ha podido responder a esa petición.",
  invalid_output: "La IA devolvió una respuesta incompleta; inténtalo otra vez.",
  auth: "La IA no está configurada en el servidor.",
  aborted: "Cancelado.",
  unknown: "Error de la IA; inténtalo otra vez.",
};

const isAiError = (e: unknown): e is AiError => e instanceof AiError || (e instanceof Error && e.name === "AiError");

/** Friendly text for an AI failure, or null if it is not one. */
export function aiMessage(e: unknown) {
  return isAiError(e) ? (MESSAGE[e.code] ?? e.message) : null;
}

/** For server actions: AI failures become a UserError the client can show. */
export async function aiAction<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    const m = aiMessage(e);
    throw m ? new UserError(m) : e;
  }
}

/** Map AiError → friendly JSON (route() handles the rest). */
export function aiErrorResponse(e: unknown) {
  if (e instanceof AiError || (e instanceof Error && e.name === "AiError")) {
    const code = (e as AiError).code ?? "unknown";
    return json({ error: MESSAGE[code] ?? e.message, code, retryable: (e as AiError).retryable }, STATUS[code] ?? 502);
  }
  return null;
}

export function withAi(fn: () => Promise<Response>) {
  return fn().catch((e) => {
    const r = aiErrorResponse(e);
    if (r) return r;
    throw e;
  });
}

/** Whether the server has an AI backend configured (doesn't instantiate it). */
export function aiConfigured() {
  const b = process.env.AI_BACKEND ?? "subscription";
  return b === "mock" || (b === "api" ? !!process.env.ANTHROPIC_API_KEY : !!process.env.CLAUDE_CODE_OAUTH_TOKEN);
}
