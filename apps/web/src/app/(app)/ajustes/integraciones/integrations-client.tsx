"use client";
import { submitForm } from "@/lib/forms";
import { errorText } from "@/lib/errors";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { Copy, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { connectOpenGym, createApiToken, createWebhook, deleteWebhook, disconnectIntegration, revokeApiToken, setWebhookEnabled, syncIntegration, testWebhook } from "@/actions/settings";
import { connectOpenPricesAction } from "@/actions/receipts";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/format";

const copy = (s: string) => void navigator.clipboard.writeText(s).then(() => toast.success("Copiado"));

function Secret({ value, note }: { value: string; note: string }) {
  return (
    <div className="space-y-1 rounded-xl border border-herb bg-herb-soft/50 p-3">
      <p className="text-sm font-medium">{note}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-card px-2 py-1 font-mono text-xs">{value}</code>
        <Button size="icon-sm" variant="outline" aria-label="Copiar" onClick={() => copy(value)}>
          <Copy />
        </Button>
      </div>
    </div>
  );
}

export function CodeLine({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-ink p-3 text-paper">
      <code className="min-w-0 flex-1 break-all font-mono text-xs">{text}</code>
      <button type="button" aria-label="Copiar" onClick={() => copy(text)} className="shrink-0 opacity-70 hover:opacity-100">
        <Copy className="size-4" />
      </button>
    </div>
  );
}

/* --------------------------------- tokens --------------------------------- */

export function NewToken() {
  const [token, setToken] = useState<string | null>(null);
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [pending, start] = useSafeTransition();
  return (
    <div className="space-y-3">
      <form
        className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_8rem_auto] sm:items-end"
        onSubmit={submitForm((fd) =>
          start(async () => {
            const t = await createApiToken({ name: String(fd.get("name")), scopes, expiresDays: fd.get("exp") ? Number(fd.get("exp")) : null });
            setToken(t);
          })
        )}
      >
        <Field label="Nombre">
          <Input name="name" required maxLength={40} placeholder="Claude Code, Home Assistant…" />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-ink-2">Permisos</legend>
          <div className="flex gap-1">
            {[
              ["read", "leer"],
              ["write", "escribir"],
              ["destroy", "borrar"],
            ].map(([k, l]) => (
              <button key={k} type="button" aria-pressed={scopes.includes(k!)} onClick={() => setScopes((s) => (s.includes(k!) ? s.filter((x) => x !== k) : [...s, k!]))} className={cn("h-10 rounded-xl border px-3 text-sm", scopes.includes(k!) ? "border-herb bg-herb-soft text-herb" : "border-line")}>
                {l}
              </button>
            ))}
          </div>
        </fieldset>
        <Field label="Caduca">
          <Select name="exp" defaultValue="365">
            <option value="30">30 días</option>
            <option value="90">90 días</option>
            <option value="365">1 año</option>
            <option value="">Nunca</option>
          </Select>
        </Field>
        <Button type="submit" disabled={pending || !scopes.length}>
          <Plus /> Crear
        </Button>
      </form>
      {token ? <Secret value={token} note="Cópialo ahora: no volverá a mostrarse." /> : null}
    </div>
  );
}

export function RevokeToken({ id }: { id: string }) {
  const [pending, start] = useSafeTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => revokeApiToken(id))}>
      Revocar
    </Button>
  );
}

/* -------------------------------- webhooks -------------------------------- */

const EVENT_ES: Record<string, string> = {
  "diary.entry_created": "Comida registrada",
  "weight.logged": "Peso registrado",
  "goal.reached": "Meta alcanzada",
  "pantry.expiring": "Caducidad cercana",
  "plan.ready": "Plan listo",
  "report.weekly": "Informe semanal",
  "achievement.unlocked": "Logro desbloqueado",
};

export function NewWebhook({ events }: { events: string[] }) {
  const [sel, setSel] = useState<string[]>(["goal.reached", "pantry.expiring"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, start] = useSafeTransition();
  return (
    <div className="space-y-3">
      <form
        className="space-y-2"
        onSubmit={submitForm((fd) =>
          start(async () => {
            try {
              setSecret(await createWebhook({ url: String(fd.get("url")), events: sel }));
            } catch (e) {
              toast.error(errorText(e, "URL no válida"));
            }
          })
        )}
      >
        <Field label="URL de destino">
          <Input name="url" type="url" required placeholder="https://homeassistant.local:8123/api/webhook/nutria" />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {events.map((e) => (
            <button key={e} type="button" aria-pressed={sel.includes(e)} onClick={() => setSel((s) => (s.includes(e) ? s.filter((x) => x !== e) : [...s, e]))} className={cn("rounded-full border px-3 py-1 text-sm", sel.includes(e) ? "border-herb bg-herb-soft text-herb" : "border-line")}>
              {EVENT_ES[e] ?? e}
            </button>
          ))}
        </div>
        <Button type="submit" disabled={pending || !sel.length}>
          <Plus /> Añadir webhook
        </Button>
      </form>
      {secret ? <Secret value={secret} note="Secreto de firma (cabecera X-Nutria-Signature, HMAC-SHA256). Cópialo ahora." /> : null}
    </div>
  );
}

export function WebhookActions({ id, enabled }: { id: string; enabled: boolean }) {
  const [pending, start] = useSafeTransition();
  return (
    <div className="flex gap-1">
      <Button size="icon-sm" variant="ghost" aria-label="Probar" disabled={pending} onClick={() => start(async () => {
        await testWebhook(id);
        toast("Enviando evento de prueba…");
      })}>
        <Send />
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => setWebhookEnabled(id, !enabled))}>
        {enabled ? "Pausar" : "Activar"}
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Borrar" disabled={pending} onClick={() => start(() => deleteWebhook(id))}>
        <Trash2 />
      </Button>
    </div>
  );
}

/* --------------------------------- openGym -------------------------------- */

export function OpenGymConnect({ personId, defaultUrl, label = "Conectar" }: { personId: string; defaultUrl: string; label?: string }) {
  const [pending, start] = useSafeTransition();
  return (
    <form
      className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end"
      onSubmit={submitForm((fd) =>
        start(async () => {
          try {
            const r = await connectOpenGym(personId, String(fd.get("url")), String(fd.get("code")));
            toast.success(r ? `openGym conectado: ${plural(r.exercises, "entreno", "entrenos")} y ${plural(r.weights, "pesaje", "pesajes")} importados` : "openGym conectado. Importando historial…");
          } catch (e) {
            toast.error(errorText(e, "No se pudo emparejar"));
          }
        })
      )}
    >
      <Field label="Dirección de openGym">
        <Input name="url" type="url" required defaultValue={defaultUrl} />
      </Field>
      <Field label="Código de emparejamiento">
        <Input name="code" required minLength={6} maxLength={12} pattern="[A-Za-z0-9]{6,12}" placeholder="K7WQ2MZP" className="num uppercase tracking-widest" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
      </Field>
      <Button type="submit" disabled={pending}>
        {label}
      </Button>
    </form>
  );
}

export function IntegrationActions({ id }: { id: string }) {
  const [pending, start] = useSafeTransition();
  return (
    <div className="flex gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await syncIntegration(id);
            if (!r) return;
            toast.success(r.fetched ? `Sincronizado: ${plural(r.exercises, "entreno", "entrenos")} y ${plural(r.weights, "pesaje", "pesajes")}${r.removed ? ` · ${plural(r.removed, "borrado", "borrados")}` : ""}` : "Sin cambios desde la última vez");
          })
        }
      >
        <RefreshCw className={pending ? "animate-spin" : undefined} /> Sincronizar ahora
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => disconnectIntegration(id))}>
        Desconectar
      </Button>
    </div>
  );
}

export function OpenPricesConnect() {
  const [pending, start] = useSafeTransition();
  return (
    <form
      className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
      onSubmit={submitForm((fd) =>
        start(async () => {
          try {
            await connectOpenPricesAction(String(fd.get("user")), String(fd.get("password")));
            toast.success("Open Prices conectado");
          } catch (e) {
            toast.error(errorText(e, "No se pudo conectar"));
          }
        })
      )}
    >
      <Field label="Usuario de Open Food Facts">
        <Input name="user" required autoComplete="username" autoCapitalize="none" spellCheck={false} />
      </Field>
      <Field label="Contraseña">
        <Input name="password" type="password" required autoComplete="current-password" />
      </Field>
      <Button type="submit" disabled={pending}>
        Conectar
      </Button>
    </form>
  );
}

export function DisconnectAccount({ id }: { id: string }) {
  const [pending, start] = useSafeTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => disconnectIntegration(id))}>
      Desconectar
    </Button>
  );
}
