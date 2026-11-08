"use client";
import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteCustomReminder, removePushSubscription, saveNotificationPref, savePushSubscription, sendTestPush } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const b64ToBytes = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export function PushToggle({ vapidKey }: { vapidKey: string | null }) {
  const [state, setState] = useState<"loading" | "unsupported" | "denied" | "off" | "on">("loading");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !vapidKey) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setEndpoint(sub?.endpoint ?? null);
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, [vapidKey]);

  const enable = () =>
    start(async () => {
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidKey!) });
        const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
        await savePushSubscription(j, navigator.userAgent);
        setEndpoint(j.endpoint);
        setState("on");
        toast.success("Avisos activados en este dispositivo");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo activar");
      }
    });
  const disable = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      await sub?.unsubscribe();
      if (endpoint) await removePushSubscription(endpoint);
      setState("off");
    });

  if (state === "unsupported")
    return <p className="text-sm text-ink-2">{vapidKey ? "Este navegador no admite notificaciones push. En iPhone/iPad, instala primero la app en la pantalla de inicio." : "El servidor no tiene configuradas las claves VAPID."}</p>;
  if (state === "denied") return <p className="text-sm text-ink-2">Has bloqueado las notificaciones. Actívalas en los ajustes del navegador para este sitio.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === "on" ? (
        <>
          <span className="flex items-center gap-1.5 text-sm font-medium text-ok">
            <Bell className="size-4" /> Activados en este dispositivo
          </span>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => void (await sendTestPush()))}>
            Probar
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={disable}>
            <BellOff /> Desactivar
          </Button>
        </>
      ) : (
        <Button disabled={pending || state === "loading"} onClick={enable}>
          <Bell /> Activar avisos en este dispositivo
        </Button>
      )}
    </div>
  );
}

export function PrefRow({ type, label, hint, enabled, times, withTimes }: { type: string; label: string; hint?: string; enabled: boolean; times: string[]; withTimes?: boolean }) {
  const [on, setOn] = useState(enabled);
  const [ts, setTs] = useState(times);
  const [pending, start] = useTransition();
  const save = (next: { enabled?: boolean; times?: string[] }) =>
    start(async () => {
      const e = next.enabled ?? on;
      const t = next.times ?? ts;
      await saveNotificationPref(type, { enabled: e, config: withTimes ? { times: t.filter(Boolean) } : {} });
    });
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{label}</p>
          {hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          disabled={pending}
          onClick={() => {
            setOn(!on);
            save({ enabled: !on });
          }}
          className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", on ? "bg-herb" : "bg-line")}
        >
          <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
        </button>
      </div>
      {withTimes && on ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {ts.map((t, i) => (
            <Input key={i} type="time" value={t} className="h-9 w-28" onChange={(e) => setTs((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} onBlur={() => save({})} />
          ))}
          <Button size="icon-sm" variant="outline" aria-label="Añadir hora" onClick={() => setTs((xs) => [...xs, "12:00"])}>
            <Plus />
          </Button>
          {ts.length ? (
            <Button size="icon-sm" variant="ghost" aria-label="Quitar última hora" onClick={() => { const n = ts.slice(0, -1); setTs(n); save({ times: n }); }}>
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function QuietHours({ initial }: { initial: [string, string] | null }) {
  const [range, setRange] = useState<[string, string]>(initial ?? ["23:00", "07:30"]);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-sm">
        De <Input type="time" value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} className="h-9 w-28" />
      </label>
      <label className="text-sm">
        a <Input type="time" value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} className="h-9 w-28" />
      </label>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
        await saveNotificationPref("quiet_hours", { enabled: true, config: { quietHours: range } });
        toast.success("Horario de silencio guardado");
      })}>
        Guardar
      </Button>
    </div>
  );
}

export function DeleteReminder({ type }: { type: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="icon-sm" variant="ghost" aria-label="Borrar recordatorio" disabled={pending} onClick={() => start(() => deleteCustomReminder(type))}>
      <Trash2 />
    </Button>
  );
}
