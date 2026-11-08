import { Suspense } from "react";
import { and, apiTokens, desc, eq, integrationAccounts, isNull, webhooks } from "@nutria/db";
import { WEBHOOK_EVENTS } from "@nutria/core";
import { decrypt } from "@nutria/integrations";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { getPersonContext } from "@/lib/session";
import { CodeLine, IntegrationActions, NewToken, NewWebhook, OpenGymConnect, RevokeToken, WebhookActions } from "./integrations-client";

export const metadata = { title: "Integraciones" };

const SCOPE_ES: Record<string, string> = { read: "leer", write: "escribir", destroy: "borrar" };
const fmt = (d: Date | null) => (d ? d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "nunca");

async function Content() {
  const ctx = await getPersonContext();
  const uid = ctx.user.id;
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const [tokens, hooks, accounts] = await Promise.all([
    db().select().from(apiTokens).where(and(eq(apiTokens.userId, uid), isNull(apiTokens.revokedAt))).orderBy(desc(apiTokens.createdAt)),
    db().select().from(webhooks).where(eq(webhooks.userId, uid)).orderBy(desc(webhooks.createdAt)),
    db().select().from(integrationAccounts).where(eq(integrationAccounts.userId, uid)),
  ]);
  const og = accounts.filter((a) => a.provider === "opengym");
  const ogHere = og.find((a) => a.personId === ctx.person.id);
  const canManage = ctx.person.role === "owner" || ctx.person.role === "manager";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="openGym" subtitle={`Importa tus entrenos y pesajes para ${ctx.person.name}. Los días de entreno activan los objetivos especiales.`} />
        {ogHere ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">
                {ogHere.baseUrl} <Badge tone={ogHere.status === "active" && !ogHere.lastError ? "ok" : "warn"}>{ogHere.lastError ? "error" : ogHere.status}</Badge>
              </p>
              <p className="text-xs text-ink-3">
                Última sincronización: {fmt(ogHere.lastSyncAt)}
                {ogHere.lastError ? ` · ${ogHere.lastError}` : ""}
              </p>
            </div>
            <IntegrationActions id={ogHere.id} />
          </div>
        ) : canManage ? (
          <>
            <p className="mb-3 text-sm text-ink-2">En openGym, ve a Ajustes → Integraciones → «Emparejar con Nutria» y copia el código.</p>
            <OpenGymConnect personId={ctx.person.id} defaultUrl={process.env.OPENGYM_URL ?? "https://nuc.tu-tailnet.ts.net:8443"} />
          </>
        ) : (
          <p className="text-sm text-ink-3">Solo quien gestiona a esta persona puede conectarla.</p>
        )}
        {ogHere?.webhookSecretEnc ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-ink-2">Para tiempo real, añade en openGym este webhook y su secreto de firma:</p>
            <CodeLine text={`${base}/api/hooks/opengym/${ogHere.id}`} />
            <CodeLine text={decrypt(ogHere.webhookSecretEnc)} />
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Tokens de API y MCP" subtitle="Para Claude Code, scripts o Home Assistant. «Borrar» pide confirmación en cada llamada MCP." />
        <NewToken />
        {tokens.length ? (
          <ul className="mt-4 divide-y divide-line text-sm">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  <b className="font-medium">{t.name}</b> <code className="text-xs text-ink-3">{t.prefix}…</code>
                  <span className="block text-xs text-ink-3">
                    {t.scopes.map((s) => SCOPE_ES[s] ?? s).join(", ")} · último uso {fmt(t.lastUsedAt)}
                    {t.expiresAt ? ` · caduca ${fmt(t.expiresAt)}` : ""}
                  </span>
                </span>
                <RevokeToken id={t.id} />
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium">Conectar Claude Code (MCP)</p>
          <CodeLine text={`claude mcp add --transport http nutria ${base}/api/mcp --header "Authorization: Bearer <tu token>"`} />
          <p className="text-sm font-medium">Registrar el peso desde otra app (báscula, Atajos, Home Assistant)</p>
          <CodeLine text={`curl -X POST ${base}/api/hooks/weight -H "Authorization: Bearer <token con escribir>" -H "Content-Type: application/json" -d '{"kg": 72.4}'`} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Webhooks de salida" subtitle="Nutria avisa a otra URL cuando pasa algo" />
        <NewWebhook events={[...WEBHOOK_EVENTS]} />
        {hooks.length ? (
          <ul className="mt-4 divide-y divide-line text-sm">
            {hooks.map((h) => (
              <li key={h.id} className={`flex items-center gap-2 py-2 ${h.enabled ? "" : "opacity-60"}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{h.url}</span>
                  <span className="block text-xs text-ink-3">
                    {h.events.length} eventos · último envío {fmt(h.lastDeliveryAt)}
                    {h.lastStatus ? ` (HTTP ${h.lastStatus})` : ""}
                  </span>
                </span>
                <WebhookActions id={h.id} enabled={h.enabled} />
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}

export default function IntegracionesPage() {
  return (
    <>
      <PageHeader title="Integraciones" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}
