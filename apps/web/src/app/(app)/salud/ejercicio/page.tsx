import { Suspense } from "react";
import Link from "next/link";
import { activities, and, asc, desc, eq, exerciseLogs, gte, stepLogs } from "@nutria/db";
import { addDays, todayIn } from "@nutria/nutrition";
import { SeriesChart } from "@/components/charts/weight-chart";
import { DeleteExercise, ExerciseForm, StepsForm } from "@/components/health/forms";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty, Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { n0, relativeDay } from "@/lib/format";
import { requireScope } from "@/lib/session";

export const metadata = { title: "Ejercicio y pasos" };

type WorkoutSet = { kg: number | null; reps: number | null };
type WorkoutExercise = { id: string; name: string; sets: WorkoutSet[] };

const kgText = (kg: number) => `${Number(kg.toFixed(1)).toLocaleString("es-ES")} kg`;

/** «3×8 · 60 kg» when every set is the same, otherwise «8×60 kg, 8×60 kg, 6×65 kg». */
function setsText(sets: WorkoutSet[]) {
  if (!sets.length) return "";
  const same = sets.every((s) => s.kg === sets[0]!.kg && s.reps === sets[0]!.reps);
  if (same) {
    const s = sets[0]!;
    return `${sets.length}×${s.reps ?? "?"}${s.kg ? ` · ${kgText(s.kg)}` : ""}`;
  }
  return sets.map((s) => `${s.reps ?? "?"}${s.kg ? `×${kgText(s.kg)}` : ""}`).join(", ");
}

function workoutExercises(details: Record<string, unknown>): WorkoutExercise[] {
  return Array.isArray(details.exercises) ? (details.exercises as WorkoutExercise[]).filter((e) => e && typeof e.name === "string" && Array.isArray(e.sets)) : [];
}

async function Content() {
  const ctx = await requireScope("body");
  const pid = ctx.person.id;
  const today = todayIn(ctx.person.timezone);
  const from = addDays(today, -27);
  const [acts, logs, steps] = await Promise.all([
    db().select().from(activities).orderBy(asc(activities.category), asc(activities.nameEs)),
    db().select().from(exerciseLogs).where(and(eq(exerciseLogs.personId, pid), gte(exerciseLogs.date, from))).orderBy(desc(exerciseLogs.date), desc(exerciseLogs.createdAt)),
    db().select().from(stepLogs).where(and(eq(stepLogs.personId, pid), gte(stepLogs.date, from))).orderBy(asc(stepLogs.date)),
  ]);
  const days = Array.from({ length: 28 }, (_, i) => addDays(from, i));
  const kcalBy = new Map<string, number>();
  for (const l of logs) kcalBy.set(l.date, (kcalBy.get(l.date) ?? 0) + l.kcal);
  const stepsBy = new Map(steps.map((s) => [s.date, s.steps]));
  const week = logs.filter((l) => l.date >= addDays(today, -6));
  const weekMin = week.reduce((a, l) => a + l.durationMin, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <Card>
          <CardHeader title="Gasto por ejercicio" subtitle={`Esta semana: ${week.length} sesiones · ${n0(weekMin)} min · ${n0(week.reduce((a, l) => a + l.kcal, 0))} kcal`} />
          <SeriesChart data={days.map((d) => ({ date: d, value: kcalBy.get(d) ?? null }))} color="var(--persimmon)" unit="kcal" />
          <p className="mt-2 text-xs text-ink-3">La OMS recomienda al menos 150 min/semana de actividad moderada. {weekMin >= 150 ? "¡Cumplido esta semana!" : `Te faltan ${n0(150 - weekMin)} min.`}</p>
          {ctx.canWrite ? (
            <div className="mt-4 border-t border-line pt-4">
              <ExerciseForm personId={pid} today={today} activities={acts} />
            </div>
          ) : null}
        </Card>
        <Card>
          <CardHeader title="Sesiones" action={<Link href="/ajustes/integraciones" className="text-sm text-herb hover:underline">Conectar openGym</Link>} />
          {logs.length ? (
            <ul className="divide-y divide-line text-sm">
              {logs.map((l) => {
                const exs = workoutExercises(l.details);
                const prs = Array.isArray(l.details.prs) ? (l.details.prs as string[]) : [];
                return (
                  <li key={l.id} className="py-2">
                    <div className="flex items-center gap-3">
                      <span className="w-20 text-ink-3">{relativeDay(l.date, today)}</span>
                      <span className="flex-1">
                        {l.name} <span className="text-ink-3">· {n0(l.durationMin)} min</span>
                        {l.volumeKg ? <span className="text-ink-3"> · {n0(l.volumeKg)} kg de volumen</span> : null}
                      </span>
                      <span className="num">{n0(l.kcal)} kcal</span>
                      {l.source !== "manual" ? <Badge>{l.source}</Badge> : ctx.canWrite ? <DeleteExercise personId={pid} id={l.id} /> : null}
                    </div>
                    {exs.length ? (
                      <details className="group ml-23 mt-1">
                        <summary className="cursor-pointer text-xs text-herb hover:underline">
                          {exs.length} {exs.length === 1 ? "ejercicio" : "ejercicios"}
                          {prs.length ? ` · ${prs.length} ${prs.length === 1 ? "récord" : "récords"}` : ""}
                        </summary>
                        <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
                          {exs.map((e, i) => (
                            <li key={`${e.id}-${i}`}>
                              <span className="text-ink">{e.name}</span>
                              {e.sets.length ? <span className="num"> · {setsText(e.sets)}</span> : null}
                              {prs.includes(e.name) ? <span className="text-persimmon"> · récord</span> : null}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty title="Sin ejercicio en las últimas 4 semanas" />
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title="Pasos" subtitle={stepsBy.get(today) ? `Hoy: ${n0(stepsBy.get(today))}` : undefined} />
        <SeriesChart data={days.map((d) => ({ date: d, value: stepsBy.get(d) ?? null }))} target={8000} unit="pasos" />
        {ctx.canWrite ? (
          <div className="mt-4">
            <StepsForm personId={pid} today={today} current={stepsBy.get(today) ?? null} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export default function EjercicioPage() {
  return (
    <>
      <PageHeader title="Ejercicio y pasos" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}
