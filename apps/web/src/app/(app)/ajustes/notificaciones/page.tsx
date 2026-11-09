import { Suspense } from "react";
import { count, eq, notificationPrefs, pushSubscriptions } from "@nutria/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { DeleteReminder, PrefRow, PushToggle, QuietHours } from "./notify-client";

export const metadata = { title: "Avisos" };

const TYPES: { type: string; label: string; hint: string; times?: string[] }[] = [
  { type: "meal_reminder", label: "Registrar comidas", hint: "A las horas que elijas, si aún no has registrado", times: ["14:30", "21:30"] },
  { type: "water", label: "Beber agua", hint: "Recordatorio suave", times: ["11:00", "17:00"] },
  { type: "medication", label: "Medicación", hint: "A la hora de cada toma (ignora el silencio)" },
  { type: "supplement", label: "Suplementos", hint: "Según la pauta de cada suplemento" },
  { type: "fasting", label: "Ayuno", hint: "Al completar la meta" },
  { type: "expiry", label: "Caducidades", hint: "Productos de la despensa a punto de caducar" },
  { type: "weekly_report", label: "Informe semanal", hint: "Cada lunes" },
  { type: "bulk_review", label: "Revisión del volumen", hint: "Los lunes, si conviene cambiar las calorías (objetivo ganar)" },
  { type: "plan_ready", label: "Plan listo", hint: "Cuando la IA termina un plan" },
  { type: "retro", label: "Retrospectiva", hint: "Valorar los platos de la semana" },
  { type: "challenge", label: "Retos", hint: "Avances y resultados" },
];

async function Content() {
  const u = await getCurrentUser();
  const [prefs, [subs]] = await Promise.all([
    db().select().from(notificationPrefs).where(eq(notificationPrefs.userId, u.id)),
    db().select({ n: count() }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, u.id)),
  ]);
  const by = new Map(prefs.map((p) => [p.type, p]));
  const custom = prefs.filter((p) => p.type.startsWith("custom:"));
  const quiet = by.get("quiet_hours")?.config.quietHours as [string, string] | undefined;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Este dispositivo" subtitle={`${subs?.n ?? 0} dispositivo(s) con avisos activos`} />
        <PushToggle vapidKey={process.env.VAPID_PUBLIC_KEY ?? null} />
      </Card>
      <Card>
        <CardHeader title="Qué avisos quieres" />
        <ul className="divide-y divide-line">
          {TYPES.map((t) => {
            const p = by.get(t.type);
            const times = Array.isArray(p?.config.times) ? (p!.config.times as string[]) : (t.times ?? []);
            // Reminders with times are opt-in; event notifications are on unless disabled.
            const enabled = p ? p.enabled : !t.times;
            return <PrefRow key={t.type} type={t.type} label={t.label} hint={t.hint} enabled={enabled} times={times} withTimes={!!t.times} />;
          })}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Silencio" subtitle="Sin avisos push en esta franja (se guardan en la app)" />
        <QuietHours initial={quiet ?? null} />
      </Card>
      {custom.length ? (
        <Card>
          <CardHeader title="Recordatorios del coach" />
          <ul className="divide-y divide-line text-sm">
            {custom.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2">
                <span className="flex-1">
                  {String(c.config.title ?? "Recordatorio")} <span className="text-ink-3">· {Array.isArray(c.config.times) ? (c.config.times as string[]).join(", ") : ""}</span>
                </span>
                <DeleteReminder type={c.type} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

export default function NotificacionesPage() {
  return (
    <>
      <PageHeader title="Avisos" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}
