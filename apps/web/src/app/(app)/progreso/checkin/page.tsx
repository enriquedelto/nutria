import { Suspense } from "react";
import Link from "next/link";
import { currentCheckin, listCheckins, type CheckinRow } from "@nutria/core";
import { PHASE_LABEL, RECOVERY_LABEL, todayIn } from "@nutria/nutrition";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { requireScope } from "@/lib/session";
import { CheckinForm, StartCheckin } from "./checkin-client";

export const metadata = { title: "Check-in semanal" };

const fmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
const d = (s: string) => fmt.format(new Date(`${s}T12:00:00Z`));
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;
const rate = (n: number | null) => (n == null ? "—" : `${signed(Math.round(n * 100) / 100).replace(".", ",")} kg/sem`);

async function Content() {
  const ctx = await requireScope("body");
  const today = todayIn(ctx.person.timezone);
  const [current, history] = await Promise.all([currentCheckin(db(), ctx.person.id, today), listCheckins(db(), ctx.person.id, 12)]);
  const older = history.filter((h) => h.id !== current?.id);
  return (
    <div className="space-y-4">
      {current ? (
        <Card>
          <CardHeader title={`Semana del ${d(current.data.from)} al ${d(current.data.to)}`} subtitle={`${PHASE_LABEL[current.data.phase]} · ${current.kcalBefore ? `${current.kcalBefore} kcal al día ahora` : "sin objetivo"}`} />
          <Facts row={current} />
          {current.status === "pending" && ctx.canWrite ? (
            <CheckinForm
              personId={ctx.person.id}
              id={current.id}
              phase={current.data.phase}
              suspectDays={current.data.suspectDays}
              initial={{ adherence: current.answers.adherence ?? "all", pace: current.answers.pace ?? "keep", excludeDays: current.answers.excludeDays ?? [] }}
              proposal={current.data.proposal}
            />
          ) : (
            <Decided row={current} />
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader title="Check-in de esta semana" subtitle="Cada lunes: dos preguntas y una propuesta de calorías según tu peso de tendencia." />
          {ctx.canWrite ? <StartCheckin personId={ctx.person.id} /> : <p className="text-sm text-ink-3">Aún no hay check-in esta semana.</p>}
        </Card>
      )}
      {current ? <Recovery row={current} /> : null}
      {older.length ? (
        <Card>
          <CardHeader title="Semanas anteriores" subtitle="Cada cambio de objetivo, con su motivo" />
          <ul className="divide-y divide-line text-sm">
            {older.map((h) => (
              <li key={h.id} className="py-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{d(h.weekStart)}</span>
                  <span className="text-ink-3">{PHASE_LABEL[h.data.phase]} · {rate(h.data.observedRateKgWeek)}</span>
                  <span className="ml-auto num">{statusText(h)}</span>
                </div>
                <p className="text-ink-2">{h.data.proposal.reasons[0]}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <p className="text-xs text-ink-3">
        Los cambios son graduales (pasos de 25 kcal, como mucho 150 a la semana) y no compensan semanas atrasadas. El ritmo se cuenta con el peso de tendencia de las últimas 4 semanas; mira la gráfica en <Link href="/progreso" className="text-herb underline">Progreso</Link>.
      </p>
    </div>
  );
}

function statusText(h: CheckinRow) {
  if (h.status === "pending") return "sin decidir";
  if (h.status === "rejected") return "sin cambios (rechazado)";
  const diff = h.kcalAfter != null && h.kcalBefore != null ? h.kcalAfter - h.kcalBefore : 0;
  return diff ? `${signed(diff)} kcal → ${h.kcalAfter}` : "sin cambios";
}

function Facts({ row }: { row: CheckinRow }) {
  const x = row.data;
  const items: [string, string][] = [
    ["Peso de tendencia", x.weightKg ? `${String(x.weightKg).replace(".", ",")} kg` : "—"],
    ["Ritmo (4 semanas)", rate(x.observedRateKgWeek)],
    ["Objetivo", rate(x.proposal.targetRateKgWeek)],
    ["Días registrados", `${x.weekLoggedDays} de 7`],
    ["Pesajes", `${x.weekWeighIns}`],
    ["Media ingerida", x.avgIntake ? `${x.avgIntake} kcal` : "—"],
  ];
  return (
    <dl className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-xl bg-paper-2 px-3 py-2">
          <dt className="text-xs text-ink-3">{k}</dt>
          <dd className="num font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Decided({ row }: { row: CheckinRow }) {
  return (
    <div className="space-y-1 text-sm">
      {row.data.proposal.reasons.map((r) => (
        <p key={r}>{r}</p>
      ))}
      <p className="font-medium">{row.status === "pending" ? "Pendiente de decidir." : `Decidido: ${statusText(row)}.`}</p>
    </div>
  );
}

function Recovery({ row }: { row: CheckinRow }) {
  const r = row.data.recovery;
  return (
    <Card>
      <CardHeader title={`Recuperación: ${RECOVERY_LABEL[r.level]}`} subtitle={r.sources.length ? `Con: ${r.sources.join(", ")}` : "Sin datos de entreno, pulso ni sueño"} />
      <ul className="space-y-1 text-sm">
        {r.reasons.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </Card>
  );
}

export default function CheckinPage() {
  return (
    <>
      <PageHeader title="Check-in semanal" subtitle="Cómo vas y si conviene cambiar las calorías" />
      <Suspense fallback={<Skeleton className="h-80" />}>
        <Content />
      </Suspense>
    </>
  );
}
