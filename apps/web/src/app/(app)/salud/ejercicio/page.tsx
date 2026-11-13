import { Suspense } from "react";
import Link from "next/link";
import { activities, and, asc, desc, eq, exerciseLogs, gte, stepLogs } from "@nutria/db";
import { addDays, prePostAnalysis, todayIn } from "@nutria/nutrition";
import { trainingMealHistory, trainingTimeContext } from "@nutria/core";
import { TrainingTimeCard } from "@/components/health/training-time-card";
import { PrePostCard } from "@/components/health/pre-post-card";
import { SeriesChart } from "@/components/charts/weight-chart";
import { DeleteExercise, ExerciseForm, StepsForm } from "@/components/health/forms";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty, Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { dateShort, n0, plural, relativeDay, sourceLabel } from "@/lib/format";
import { trainingProgress, workoutExercises, type TrainingSet } from "@/lib/data/training";
import { Sparkline } from "@/components/charts/sparkline";
import { requireScope } from "@/lib/session";

export const metadata = { title: "Ejercicio y pasos" };

const PRE_POST_WEEKS = 12;

type WorkoutSet = TrainingSet;

const kgText = (kg: number) => `${Number(kg.toFixed(1)).toLocaleString("es-ES")} kg`;
/** Reps, or seconds for timed sets. */
const amount = (s: WorkoutSet) => (s.sec ? `${s.sec} s` : String(s.reps ?? "?"));

/**
 * «3×8 · 60 kg» when every working set is the same, otherwise «8×60 kg, 8×60 kg, 6×65 kg»;
 * timed sets read «3×30 s», and warm-ups are counted apart («+1 calentamiento»).
 */
function setsText(all: WorkoutSet[]) {
  const sets = all.filter((s) => !s.warmup);
  const warm = all.length - sets.length;
  const extra = warm ? ` · +${warm} ${warm === 1 ? "calentamiento" : "calentamientos"}` : "";
  if (!sets.length) return warm ? extra.slice(3) : "";
  const same = sets.every((s) => s.kg === sets[0]!.kg && s.reps === sets[0]!.reps && s.sec === sets[0]!.sec);
  if (same) {
    const s = sets[0]!;
    return `${sets.length}×${amount(s)}${s.kg ? ` · ${kgText(s.kg)}` : ""}${extra}`;
  }
  return sets.map((s) => `${amount(s)}${s.kg ? `×${kgText(s.kg)}` : ""}`).join(", ") + extra;
}


async function Content() {
  const ctx = await requireScope("body");
  const pid = ctx.person.id;
  const today = todayIn(ctx.person.timezone);
  const from = addDays(today, -27);
  const [acts, logs, steps, history] = await Promise.all([
    db().select().from(activities).orderBy(asc(activities.category), asc(activities.nameEs)),
    db().select().from(exerciseLogs).where(and(eq(exerciseLogs.personId, pid), gte(exerciseLogs.date, from))).orderBy(desc(exerciseLogs.date), desc(exerciseLogs.createdAt)),
    db().select().from(stepLogs).where(and(eq(stepLogs.personId, pid), gte(stepLogs.date, from))).orderBy(asc(stepLogs.date)),
    db()
      .select({ date: exerciseLogs.date, volumeKg: exerciseLogs.volumeKg, details: exerciseLogs.details })
      .from(exerciseLogs)
      .where(and(eq(exerciseLogs.personId, pid), gte(exerciseLogs.date, addDays(today, -730))))
      .orderBy(asc(exerciseLogs.date)),
  ]);
  const progress = trainingProgress(history, today);
  // Pre/post-workout meals need the diary too.
  const mealHistory = ctx.scopes.has("diary") ? await trainingMealHistory(db(), pid, PRE_POST_WEEKS) : null;
  const prePost = mealHistory?.weightKg ? prePostAnalysis(mealHistory.sessions, mealHistory.meals, mealHistory.weightKg) : null;
  const trainingTime = await trainingTimeContext(db(), pid);
  const recentWeeks = progress.weekly.filter((w) => w.sessions > 0);
  const hasVolume = progress.weekly.some((w) => w.volumeKg > 0);
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
          <CardHeader title="Gasto por ejercicio" subtitle={`Esta semana: ${plural(week.length, "sesión", "sesiones")} · ${n0(weekMin)} min · ${n0(week.reduce((a, l) => a + l.kcal, 0))} kcal`} />
          <SeriesChart data={days.map((d) => ({ date: d, value: kcalBy.get(d) ?? null }))} color="var(--persimmon)" unit="kcal" />
          <p className="mt-2 text-xs text-ink-3">La OMS recomienda al menos 150 min/semana de actividad moderada. {weekMin >= 150 ? "¡Cumplido esta semana!" : `Te faltan ${n0(150 - weekMin)} min.`}</p>
          {ctx.canWrite ? (
            <div className="mt-4 border-t border-line pt-4">
              <ExerciseForm personId={pid} today={today} activities={acts} />
            </div>
          ) : null}
        </Card>
        <TrainingTimeCard c={trainingTime} />
        {prePost ? <PrePostCard a={prePost} weeks={PRE_POST_WEEKS} /> : null}
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
                        {l.name}{" "}
                        <span className="text-ink-3" title={l.details.durationEstimated ? "Duración estimada por el número de series (openGym no tenía la hora)" : undefined}>
                          · {l.details.durationEstimated ? "~" : ""}
                          {n0(l.durationMin)} min
                        </span>
                        {l.volumeKg ? <span className="text-ink-3"> · {n0(l.volumeKg)} kg de volumen</span> : null}
                      </span>
                      <span className="num">{n0(l.kcal)} kcal</span>
                      {l.source !== "manual" ? <Badge>{sourceLabel(l.source)}</Badge> : ctx.canWrite ? <DeleteExercise personId={pid} id={l.id} /> : null}
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
      {progress.lifts.length || hasVolume ? (
        <Card>
          <CardHeader
            title="Progreso del entreno"
            subtitle={`Últimos 6 meses: ${plural(progress.weekly.reduce((a, w) => a + w.sessions, 0), "sesión", "sesiones")} · ${recentWeeks.length} de ${progress.weekly.length} semanas con entreno`}
          />
          {hasVolume ? <SeriesChart data={progress.weekly.map((w) => ({ date: w.date, value: w.volumeKg ? Math.round(w.volumeKg / 100) / 10 : null }))} color="var(--persimmon)" unit="t por semana" /> : null}
          {progress.lifts.length ? (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Mejores marcas</h3>
              <ul className="divide-y divide-line text-sm">
                {progress.lifts.map((x) => (
                  <li key={x.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{x.name}</p>
                      <p className="text-xs text-ink-3">
                        <span className="num">
                          {n0(x.best.kg)} kg × {x.best.reps}
                        </span>{" "}
                        · 1RM estimado <span className="num">{n0(x.best.e1rm)} kg</span> · {dateShort(x.best.date)}{x.best.date.slice(0, 4) !== today.slice(0, 4) ? ` ${x.best.date.slice(0, 4)}` : ""} · {plural(x.sessions, "sesión", "sesiones")}
                      </p>
                    </div>
                    <Sparkline values={x.trend} className="h-8 w-20 shrink-0" color="var(--persimmon)" />
                    <span className={`num w-16 shrink-0 text-right text-xs ${x.change == null ? "text-ink-3" : x.change >= 0 ? "text-ok" : "text-danger"}`} title="Cambio del 1RM estimado frente a hace 3 meses">
                      {x.change == null ? "—" : `${x.change > 0 ? "+" : ""}${n0(x.change)} kg`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-3">1RM estimado con la fórmula de Epley a partir de tu mejor serie (1–12 repeticiones). La cifra de la derecha compara tu última sesión con lo mejor de hace más de 3 meses.</p>
            </div>
          ) : null}
        </Card>
      ) : null}
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
