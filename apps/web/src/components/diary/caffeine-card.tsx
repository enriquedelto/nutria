"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Coffee } from "lucide-react";
import { toast } from "sonner";
import {
  CAFFEINE_DAILY_MAX_MG,
  CAFFEINE_HALF_LIVES,
  CAFFEINE_SLEEP_MAX_MG,
  caffeineAt,
  caffeineCurve,
  caffeineLatestFor,
  caffeineMaxForSleep,
  caffeinePeakDelayMin,
  caffeinePlan,
  clockToMinutes,
  minutesToClock,
} from "@nutria/nutrition";
import type { CaffeineDay } from "@nutria/core";
import { updatePersonSettings } from "@/actions/settings";
import { CaffeineChart } from "@/components/charts/weight-chart";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { cn } from "@/lib/utils";

const TRAINING_SOURCE: Record<string, string> = { logged: "registrado hoy", usual: "tu hora habitual", default: "sin historial: 18:30" };
const BED_SOURCE: Record<string, string> = { manual: "fijada por ti", sleep: "tu hora habitual de acostarte", default: "sin registro de sueño: 23:30" };
const TIME_SOURCE: Record<string, string> = { eaten: "", slot: "hora habitual de la comida", created: "hora en que lo registraste" };

/** Caffeine in the body over the day, with a dose simulator to find the best time before training. */
export function CaffeineCard({ personId, day, canEdit }: { personId: string; day: CaffeineDay; canEdit: boolean }) {
  const [halfLifeH, setHalfLifeH] = useState(day.halfLifeH);
  const [bedtime, setBedtime] = useState(day.bedtime);
  const plan = useMemo(() => caffeinePlan({ doses: day.doses, trainingStart: day.trainingStart, bedtime, weightKg: day.weightKg, halfLifeH }), [day, bedtime, halfLifeH]);
  const [simMg, setSimMg] = useState(plan.suggestedMg || 80);
  const [simAt, setSimAt] = useState(minutesToClock(plan.idealAt ?? 15 * 60));
  const [simOn, setSimOn] = useState(day.trainingStart != null);
  const [saving, start] = useSafeTransition();

  const simDose = simOn && simMg > 0 ? { at: clockToMinutes(simAt), mg: simMg } : null;
  const withSim = simDose ? [...day.doses, simDose] : day.doses;
  const from = 6 * 60;
  const to = Math.max(32 * 60, bedtime + 120);
  // ~160 points per curve: cheap enough to recompute on every render.
  const logged = caffeineCurve(day.doses, { from, to, halfLifeH });
  const sim = simDose ? caffeineCurve(withSim, { from, to, halfLifeH }) : null;
  const data = logged.map((p, i) => ({ t: p.t, logged: p.mg, ...(sim ? { plan: sim[i]!.mg } : {}) }));

  const residual = Math.round(caffeineAt(withSim, bedtime, halfLifeH));
  const total = plan.takenMg + (simDose?.mg ?? 0);
  const lead = Math.round(caffeinePeakDelayMin(halfLifeH) / 5) * 5;
  const peak = simDose ? simDose.at + lead : null;
  const others = day.doses;
  const maxAtSim = simDose ? caffeineMaxForSleep(others, simDose.at, bedtime, halfLifeH) : null;
  const latest = simDose ? caffeineLatestFor(others, simDose.mg, bedtime, halfLifeH) : null;
  const sleepOk = residual <= CAFFEINE_SLEEP_MAX_MG;
  // A deadline before 06:00 is not advice anyone can follow: that dose does not fit today.
  const EARLIEST = 6 * 60;
  const latestUsable = latest != null && latest >= EARLIEST ? latest : null;
  // Training late with a full pre-workout dose: until when could the session start without hurting sleep?
  const latestForSuggested = plan.suggestedMg ? caffeineLatestFor(day.doses, plan.suggestedMg, bedtime, halfLifeH) : null;
  const trainBy = plan.idealAt != null && latestForSuggested != null && latestForSuggested >= EARLIEST && latestForSuggested < plan.idealAt ? latestForSuggested + lead : null;

  const saveSettings = (next: { halfLifeH?: number; bedtime?: string | null }) =>
    start(async () => {
      const h = next.halfLifeH ?? halfLifeH;
      const bed = next.bedtime === undefined ? (day.bedtimeSource === "manual" || bedtime !== day.bedtime ? minutesToClock(bedtime) : undefined) : next.bedtime ?? undefined;
      await updatePersonSettings(personId, { caffeine: { halfLifeH: h, ...(bed ? { bedtime: bed } : {}) } });
      toast.success("Ajustes de cafeína guardados");
    });

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Coffee className="size-5 text-ink-3" /> Cafeína
          </span>
        }
        subtitle={`${plan.takenMg} mg hoy · ${plan.residualAtBed} mg al acostarte (${minutesToClock(bedtime)})`}
      />
      <CaffeineChart data={data} training={day.trainingStart} bedtime={bedtime} threshold={CAFFEINE_SLEEP_MAX_MG} />

      {day.trainingStart != null && plan.idealAt != null ? (
        <p className="mt-3 text-sm">
          Entreno ≈ <span className="num font-medium">{minutesToClock(day.trainingStart)}</span> <span className="text-ink-3">({TRAINING_SOURCE[day.trainingSource ?? "default"]})</span>. Para llegar al pico al empezar, tómala hacia las{" "}
          <span className="num font-medium">{minutesToClock(plan.idealAt)}</span>.
          {trainBy != null ? (
            <span className="text-ink-2">
              {" "}
              Con {plan.suggestedMg} mg (3 mg/kg) a esa hora te quedaría demasiada al acostarte: para tomar esa dosis sin afectar al sueño, el entreno tendría que empezar antes de las{" "}
              <span className="num font-medium">{minutesToClock(Math.floor(trainBy / 5) * 5)}</span>.{" "}
              <Link href="/salud/ejercicio#hora-entreno" className="text-herb underline">
                Mejor hora para entrenar
              </Link>
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="mt-3 rounded-xl bg-paper-2 p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={simOn} onChange={(e) => setSimOn(e.target.checked)} className="size-4 accent-[var(--herb)]" />
          Simular una toma
        </label>
        {simOn ? (
          <>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Field label="Dosis (mg)">
                <Input type="number" inputMode="numeric" min={0} max={600} step={10} value={simMg} onChange={(e) => setSimMg(Math.max(0, Number(e.target.value)))} />
              </Field>
              <Field label="Hora">
                <Input type="time" value={simAt} onChange={(e) => e.target.value && setSimAt(e.target.value)} />
              </Field>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                { label: "Espresso ≈ 60 mg", mg: 60 },
                { label: "Café ≈ 80 mg", mg: 80 },
                ...(plan.suggestedMg ? [{ label: `3 mg/kg = ${plan.suggestedMg} mg`, mg: plan.suggestedMg }] : []),
              ].map((o) => (
                <Button key={o.label} type="button" size="sm" variant={simMg === o.mg ? "soft" : "outline"} onClick={() => setSimMg(o.mg)}>
                  {o.label}
                </Button>
              ))}
              {plan.idealAt != null ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setSimAt(minutesToClock(plan.idealAt!))}>
                  Hora ideal
                </Button>
              ) : null}
            </div>
            <p className={cn("mt-3 text-sm", sleepOk ? "text-ink-2" : "text-danger")}>
              {peak != null ? (
                <>
                  Pico hacia las <span className="num">{minutesToClock(peak)}</span>.{" "}
                </>
              ) : null}
              Al acostarte te quedarían <span className="num font-medium">~{residual} mg</span>
              {sleepOk ? ": sin efecto apreciable en el sueño." : ": puede empeorar el sueño (más tarde en dormirte y sueño más ligero)."}
            </p>
            {!sleepOk && maxAtSim != null ? (
              <p className="mt-1 text-sm text-ink-2">
                {maxAtSim >= 10 ? (
                  <>
                    A las {simAt}, como mucho <span className="num font-medium">~{Math.floor(maxAtSim / 10) * 10} mg</span>
                  </>
                ) : (
                  <>A las {simAt} ya no cabe más cafeína</>
                )}
                {latestUsable != null ? (
                  <>
                    , o toma {simMg} mg antes de las <span className="num font-medium">{minutesToClock(Math.floor(latestUsable / 5) * 5)}</span>
                  </>
                ) : (
                  <>; {simMg} mg hoy no caben sin afectar al sueño a ninguna hora razonable</>
                )}
                .
              </p>
            ) : null}
            {total > CAFFEINE_DAILY_MAX_MG ? <p className="mt-1 text-sm text-danger">Pasarías de {CAFFEINE_DAILY_MAX_MG} mg en el día ({total} mg).</p> : null}
          </>
        ) : null}
      </div>

      {day.doses.length ? (
        <ul className="mt-3 space-y-1 text-sm">
          {day.doses.map((d) => (
            <li key={d.id} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">
                <span className="num text-ink-3">{d.at < 0 ? "ayer " : ""}{minutesToClock(d.at)}</span> {d.name}
                {TIME_SOURCE[d.timeSource] ? <span className="text-xs text-ink-3"> · {TIME_SOURCE[d.timeSource]}</span> : null}
              </span>
              <span className="num shrink-0 text-ink-2">{d.mg} mg</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink-3">Hoy no hay cafeína registrada.</p>
      )}
      {day.doses.some((d) => d.timeSource !== "eaten") ? <p className="mt-1 text-xs text-ink-3">Para afinar la curva, pon la hora real en cada registro (tócalo → Hora).</p> : null}

      <details className="mt-3 border-t border-line pt-2">
        <summary className="cursor-pointer py-1 text-sm font-semibold">Ajustes</summary>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Field label="Vida media">
            <Select
              value={String(halfLifeH)}
              disabled={!canEdit || saving}
              onChange={(e) => {
                const h = Number(e.target.value);
                setHalfLifeH(h);
                saveSettings({ halfLifeH: h });
              }}
            >
              {[...CAFFEINE_HALF_LIVES, ...(CAFFEINE_HALF_LIVES.some((x) => x.h === halfLifeH) ? [] : [{ h: halfLifeH, label: `${halfLifeH} h`, hint: day.halfLifeSource === "pregnancy" ? "embarazo" : "" }])].map((x) => (
                <option key={x.h} value={x.h}>
                  {x.label}
                  {x.hint ? ` · ${x.hint}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Me acuesto a las">
            <Input
              type="time"
              value={minutesToClock(bedtime)}
              disabled={!canEdit || saving}
              onChange={(e) => {
                if (!e.target.value) return;
                const m = clockToMinutes(e.target.value);
                setBedtime(m < 12 * 60 ? m + 1440 : m);
              }}
              onBlur={() => bedtime !== day.bedtime && saveSettings({ bedtime: minutesToClock(bedtime) })}
            />
          </Field>
        </div>
        <p className="mt-1 text-xs text-ink-3">
          Hora de acostarte: {BED_SOURCE[day.bedtimeSource]}.
          {day.bedtimeSource === "manual" && canEdit ? (
            <>
              {" "}
              <button type="button" className="text-herb underline" disabled={saving} onClick={() => saveSettings({ bedtime: null })}>
                Usar la de mi registro de sueño
              </button>
            </>
          ) : null}
        </p>
      </details>
      <p className="mt-2 text-xs text-ink-3">
        Estimación media: la vida media real varía mucho entre personas (2–10 h). Umbral de sueño: ≤ {CAFFEINE_SLEEP_MAX_MG} mg al acostarte (Gardiner et al., 2023). Antes de entrenar: 3–6 mg/kg (ISSN, 2021).
      </p>
    </Card>
  );
}
