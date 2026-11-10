import { Suspense } from "react";
import { and, apiTokens, desc, eq, integrationAccounts, isNull, webhooks } from "@nutria/db";
import { WEBHOOK_EVENTS } from "@nutria/core";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { getPersonContext } from "@/lib/session";
import { CodeLine, DisconnectAccount, IntegrationActions, NewToken, NewWebhook, OpenGymConnect, OpenPricesConnect, RevokeToken, WebhookActions } from "./integrations-client";
import { plural } from "@/lib/format";

export const metadata = { title: "Integraciones" };

const SCOPE_ES: Record<string, string> = { read: "leer", write: "escribir", destroy: "borrar" };
const fmt = (d: Date | null) => (d ? d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "nunca");
const ago = (d: Date | null) => {
  if (!d) return "todavía no";
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`;
  return fmt(d);
};

const OG_STEPS = "En openGym: Ajustes → «Emparejar la app móvil» → confirma con tu passkey o contraseña → copia el código (8 letras y números; caduca en 5 minutos).";

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
  const op = accounts.find((a) => a.provider === "open_prices");
  const opBase = (process.env.OPEN_PRICES_WRITE_URL ?? process.env.OPEN_PRICES_URL ?? "https://prices.openfoodfacts.org").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const canManage = ctx.person.role === "owner" || ctx.person.role === "manager";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="openGym" subtitle={`Importa tus entrenos y pesajes para ${ctx.person.name}. Los días de entreno activan los objetivos especiales.`} />
        {ogHere ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  {typeof ogHere.meta.name === "string" ? `${ogHere.meta.name} · ` : ""}
                  <span className="text-ink-2">{(ogHere.baseUrl ?? "").replace(/^https?:\/\//, "")}</span>{" "}
                  <Badge tone={ogHere.status === "active" && !ogHere.lastError ? "ok" : "warn"}>{ogHere.status === "reauth" ? "hay que volver a emparejar" : ogHere.lastError ? "error" : "conectado"}</Badge>
                </p>
                <p className="text-xs text-ink-3">
                  Se sincroniza sola cada 2 min · última {ago(ogHere.lastSyncAt)}
                  {typeof ogHere.meta.workouts === "number" ? ` · ${plural(ogHere.meta.workouts, "entreno", "entrenos")} y ${plural(Number(ogHere.meta.weighIns ?? 0), "pesaje", "pesajes")}` : ""}
                </p>
                {ogHere.lastError ? <p className="mt-1 text-xs text-danger">{ogHere.lastError}</p> : null}
              </div>
              <IntegrationActions id={ogHere.id} />
            </div>
            {ogHere.status === "reauth" && canManage ? (
              <div className="rounded-xl bg-paper-2 p-3">
                <p className="mb-3 text-sm text-ink-2">{OG_STEPS}</p>
                <OpenGymConnect personId={ctx.person.id} defaultUrl={ogHere.baseUrl ?? process.env.OPENGYM_URL ?? ""} label="Volver a emparejar" />
              </div>
            ) : null}
          </div>
        ) : canManage ? (
          <>
            <p className="mb-3 text-sm text-ink-2">{OG_STEPS}</p>
            <OpenGymConnect personId={ctx.person.id} defaultUrl={process.env.OPENGYM_URL ?? "https://gym.tu-dominio.example"} />
          </>
        ) : (
          <p className="text-sm text-ink-3">Solo quien gestiona a esta persona puede conectarla.</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Open Prices" subtitle="Base de datos abierta de precios de Open Food Facts. Al guardar un ticket puedes compartir sus precios; se pregunta cada vez." />
        {op ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{typeof op.meta.username === "string" ? op.meta.username : "Cuenta"}</span> <span className="text-ink-2">· {opBase}</span>{" "}
              <Badge tone={op.status === "active" ? "ok" : "warn"}>{op.status === "active" ? "conectado" : "hay que volver a conectar"}</Badge>
              {op.lastError ? <span className="block text-xs text-danger">{op.lastError}</span> : null}
            </p>
            <DisconnectAccount id={op.id} />
          </div>
        ) : null}
        {!op || op.status !== "active" ? (
          <div className="space-y-2">
            <p className="text-sm text-ink-2">
              Con tu cuenta de Open Food Facts (la misma de la app de Open Food Facts). La contraseña solo se usa para pedir un token; no se guarda.{" "}
              <a href="https://world.openfoodfacts.org/cgi/user.pl" target="_blank" rel="noreferrer" className="text-herb underline">
                Crear cuenta
              </a>
            </p>
            <OpenPricesConnect />
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink-3">Lo que compartes es público: la foto del ticket (recortada por ti), la tienda, la fecha y los precios con código de barras.</p>
        )}
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
          <p className="text-sm font-medium">Cuando tengas reloj o pulsera: pasos, sueño, pulso y ejercicio</p>
          <p className="text-sm text-ink-2">
            En Android, una app que lea Health Connect y lo envíe por webhook (p. ej. «Health Connect Webhook») con esta dirección y la cabecera <code>Authorization: Bearer &lt;token con escribir&gt;</code>. También vale desde Atajos de iOS o Home Assistant. Reenviar lo mismo no duplica nada.
          </p>
          <CodeLine text={`curl -X POST ${base}/api/hooks/health -H "Authorization: Bearer <token con escribir>" -H "Content-Type: application/json" -d '{"steps":[{"count":8200,"start_time":"2026-11-10T07:00:00Z"}],"sleep":[{"session_end_time":"2026-11-10T06:30:00Z","duration_seconds":27000}]}'`} />
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
