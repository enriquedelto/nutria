"use client";
import { useState } from "react";
import { toast } from "sonner";
import type { Adherence, CheckinProposal, DietPhase, Pace } from "@nutria/nutrition";
import { answerCheckinAction, decideCheckinAction, startCheckin } from "@/actions/checkin";
import { Button } from "@/components/ui/button";
import { useSafeTransition } from "@/lib/use-safe-transition";

const ADHERENCE: [Adherence, string][] = [
  ["all", "Lo registré todo"],
  ["some", "Solo algunas comidas"],
  ["untracked", "No registré, pero cumplí"],
];
const PACE: Record<DietPhase, [Pace, string][]> = {
  bulk: [["slower", "Frenar"], ["keep", "Mantener ritmo"], ["faster", "Acelerar"]],
  cut: [["slower", "Frenar"], ["keep", "Mantener ritmo"], ["faster", "Acelerar"]],
  maintain: [],
};

const dayFmt = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", timeZone: "UTC" });

export function StartCheckin({ personId }: { personId: string }) {
  const [pending, start] = useSafeTransition();
  return (
    <Button disabled={pending} onClick={() => start(async () => void (await startCheckin(personId)))}>
      Hacer el check-in ahora
    </Button>
  );
}

function Choice<T extends string>({ label, options, value, onChange, disabled }: { label: string; options: [T, string][]; value: T; onChange: (v: T) => void; disabled: boolean }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            disabled={disabled}
            onClick={() => onChange(v)}
            className="rounded-full border border-line px-3 py-1.5 text-sm aria-pressed:border-herb aria-pressed:bg-herb-soft aria-pressed:font-medium"
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function CheckinForm({
  personId,
  id,
  phase,
  suspectDays,
  initial,
  proposal,
}: {
  personId: string;
  id: string;
  phase: DietPhase;
  suspectDays: { date: string; kcal: number }[];
  initial: { adherence: Adherence; pace: Pace; excludeDays: string[] };
  proposal: CheckinProposal;
}) {
  const [answers, setAnswers] = useState(initial);
  const [p, setP] = useState(proposal);
  const [pending, start] = useSafeTransition();
  const total = p.kcalDelta + p.paceKcal;

  const change = (next: typeof answers) => {
    setAnswers(next);
    start(async () => {
      const r = await answerCheckinAction(personId, id, next);
      setP((cur) => ({ ...cur, ...r }));
    });
  };
  const decide = (accept: boolean) =>
    start(async () => {
      const r = await decideCheckinAction(personId, id, accept);
      toast.success(!accept ? "Sin cambios esta semana" : total && r.kcalAfter ? `Objetivo: ${r.kcalAfter} kcal al día` : "Check-in hecho");
    });

  return (
    <div className="space-y-4">
      <Choice label="¿Cómo fue el registro esta semana?" options={ADHERENCE} value={answers.adherence} disabled={pending} onChange={(adherence) => change({ ...answers, adherence })} />
      {suspectDays.length ? (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Estos días parecen a medias. ¿Los excluyo de las medias?</legend>
          <ul className="space-y-1">
            {suspectDays.map((s) => {
              const on = answers.excludeDays.includes(s.date);
              return (
                <li key={s.date}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={pending}
                      onChange={() => change({ ...answers, excludeDays: on ? answers.excludeDays.filter((x) => x !== s.date) : [...answers.excludeDays, s.date] })}
                    />
                    <span className="first-letter:uppercase">{dayFmt.format(new Date(`${s.date}T12:00:00Z`))}</span>
                    <span className="num text-ink-3">{s.kcal} kcal</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}
      {PACE[phase].length ? <Choice label="Ritmo" options={PACE[phase]} value={answers.pace} disabled={pending} onChange={(pace) => change({ ...answers, pace })} /> : null}

      <div className="rounded-xl bg-herb-soft/60 p-3 text-sm" aria-live="polite">
        {p.reasons.map((r) => (
          <p key={r}>{r}</p>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {total ? (
          <>
            <Button disabled={pending} onClick={() => decide(true)}>
              {total > 0 ? "Subir" : "Bajar"} {Math.abs(total)} kcal al día
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => decide(false)}>
              No cambiar
            </Button>
          </>
        ) : (
          <Button disabled={pending} onClick={() => decide(true)}>
            Hecho
          </Button>
        )}
      </div>
    </div>
  );
}
