import { and, eq, integrationAccounts } from "@nutria/db";
import { decrypt, verifyOpenGymWebhook } from "@nutria/integrations";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { HttpError } from "@/lib/api";
import { publicRoute } from "@/lib/tokens";

/** openGym → Nutria real-time webhook (HMAC-signed). Any event triggers an idempotent sync. */
export const POST = publicRoute<RouteContext<"/api/hooks/opengym/[id]">>(async (req, ctx) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "No encontrado");
  const [acc] = await db().select().from(integrationAccounts).where(and(eq(integrationAccounts.id, id), eq(integrationAccounts.provider, "opengym"))).limit(1);
  if (!acc?.webhookSecretEnc) throw new HttpError(404, "No encontrado");
  const raw = await req.text();
  if (raw.length > 1_000_000) throw new HttpError(413, "Demasiado grande");
  const hook = verifyOpenGymWebhook(decrypt(acc.webhookSecretEnc), raw, req.headers.get("x-opengym-signature") ?? req.headers.get("x-signature"));
  if (!hook) throw new HttpError(401, "Firma no válida");
  await enqueue("opengym.sync", { accountId: acc.id }, { singletonKey: `og:${acc.id}` });
  return Response.json({ ok: true, event: hook.event });
});
