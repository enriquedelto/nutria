"use client";
import { errorText } from "@/lib/errors";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteSupplementPlan, saveSupplementPlan, setSupplementActive } from "@/actions/health";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type CatalogView = {
  code: string;
  name: string;
  evidence: "A" | "B" | "C";
  purpose: string;
  timing: string;
  doseLabel: string;
  dose: number;
  doseUnit: string;
  grams: number;
  defaultTime: string;
  days: number[];
  cautions: string[];
  planned: boolean;
  recommended: boolean;
};

type Plan = { id: string; name: string; code: string | null; doseLabel: string; dose: number; doseUnit: string; gramsPerDose: number; times: string[]; daysOfWeek: number[]; active: boolean; streak: number; kcalPerDose: number; proteinPerDose: number };

const DAYS = ["L", "M", "X", "J", "V", "S", "D"];
const DAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const EVIDENCE: Record<string, { label: string; tone: "ok" | "herb" | "neutral" }> = { A: { label: "Evidencia A", tone: "ok" }, B: { label: "Evidencia B", tone: "herb" }, C: { label: "Evidencia C", tone: "neutral" } };
const daysText = (d: number[]) => (d.length === 7 ? "todos los días" : d.map((x) => DAYS[x - 1]).join(" "));

function DayChips({ value, onChange }: { value: number[]; onChange: (d: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {DAYS.map((d, i) => (
        <button key={d} type="button" aria-label={DAY_NAMES[i]} aria-pressed={value.includes(i + 1)} onClick={() => onChange(value.includes(i + 1) ? value.filter((x) => x !== i + 1) : [...value, i + 1].sort())} className={cn("size-8 rounded-full border text-xs font-medium", value.includes(i + 1) ? "border-herb bg-herb-soft text-herb" : "border-line hover:bg-paper-2")}>
          {d}
        </button>
      ))}
    </div>
  );
}

export function CatalogItem({ personId, item, canWrite }: { personId: string; item: CatalogView; canWrite: boolean }) {
  const [pending, start] = useSafeTransition();
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(item.defaultTime);
  const [days, setDays] = useState(item.days);
  const ev = EVIDENCE[item.evidence]!;
  return (
    <div className={cn("rounded-xl border p-3", item.recommended ? "border-herb" : "border-line")}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">{item.name}</p>
        <Badge tone={ev.tone}>{ev.label}</Badge>
        {item.recommended ? <Badge tone="herb">para ti</Badge> : null}
      </div>
      <p className="mt-1 text-sm">{item.purpose}</p>
      <p className="mt-1 text-sm text-ink-2">
        <span className="font-medium text-ink">Dosis:</span> {item.doseLabel}. {item.timing}
      </p>
      {item.cautions.length ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink-3">
          {item.cautions.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
      {canWrite ? (
        item.planned ? (
          <p className="mt-2 flex items-center gap-1 text-sm text-ok">
            <Check className="size-4" /> Ya está en tus pautas
          </p>
        ) : open ? (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Hora del aviso">
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
              </Field>
              <Field label="Días">
                <DayChips value={days} onChange={setDays} />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={pending || !days.length}
                onClick={() =>
                  start(async () => {
                    try {
                      await saveSupplementPlan(personId, { code: item.code, dose: item.dose, doseUnit: item.doseUnit, gramsPerDose: item.grams, times: time ? [time] : [], daysOfWeek: days });
                      toast.success(`${item.name} añadida a tus pautas`);
                      setOpen(false);
                    } catch (e) {
                      toast.error(errorText(e, "Error"));
                    }
                  })
                }
              >
                <Check /> Guardar pauta
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)}>
            <Plus /> Añadir pauta
          </Button>
        )
      ) : null}
    </div>
  );
}

export function PlanList({ personId, plans, canWrite }: { personId: string; plans: Plan[]; canWrite: boolean }) {
  if (!plans.length) return null;
  return (
    <ul className="divide-y divide-line">
      {plans.map((p) => (
        <PlanRow key={p.id} personId={personId} plan={p} canWrite={canWrite} />
      ))}
    </ul>
  );
}

function PlanRow({ personId, plan, canWrite }: { personId: string; plan: Plan; canWrite: boolean }) {
  const [pending, start] = useSafeTransition();
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [dose, setDose] = useState(plan.dose);
  const [time, setTime] = useState(plan.times[0] ?? "");
  const [days, setDays] = useState(plan.daysOfWeek);
  const run = (fn: () => Promise<unknown>, ok?: string) =>
    start(async () => {
      try {
        await fn();
        if (ok) toast.success(ok);
      } catch (e) {
        toast.error(errorText(e, "Error"));
      }
    });
  return (
    <li className={cn("py-3", !plan.active && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {plan.name} <span className="text-ink-3">· {plan.doseLabel}</span> {!plan.active ? <Badge>en pausa</Badge> : null}
          </p>
          <p className="text-xs text-ink-3">
            {plan.times.length ? `${plan.times.join(", ")} · ` : ""}
            {daysText(plan.daysOfWeek)}
            {plan.kcalPerDose > 0 ? ` · ${plan.kcalPerDose} kcal, ${plan.proteinPerDose.toLocaleString("es-ES")} g de proteína por toma` : ""}
            {plan.streak > 1 ? ` · ${plan.streak} días seguidos` : ""}
          </p>
        </div>
        {canWrite ? (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setSupplementActive(personId, plan.id, !plan.active))}>
              {plan.active ? "Pausar" : "Reanudar"}
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Editar ${plan.name}`} onClick={() => setEdit((x) => !x)}>
              <Pencil />
            </Button>
            <Button size={confirm ? "sm" : "icon-sm"} variant={confirm ? "danger" : "ghost"} className={confirm ? undefined : "text-danger"} aria-label={`Borrar ${plan.name}`} disabled={pending} onClick={() => (confirm ? run(() => deleteSupplementPlan(personId, plan.id), "Pauta borrada") : setConfirm(true))}>
              <Trash2 /> {confirm ? "¿Seguro?" : null}
            </Button>
          </div>
        ) : null}
      </div>
      {edit ? (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <Field label={`Dosis (${plan.doseUnit})`}>
            <Input type="number" inputMode="decimal" min={0} step="any" value={dose} onChange={(e) => setDose(Number(e.target.value))} className="w-24" />
          </Field>
          <Field label="Hora">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
          </Field>
          <Field label="Días">
            <DayChips value={days} onChange={setDays} />
          </Field>
          <Button
            size="sm"
            disabled={pending || !days.length || !(dose > 0)}
            onClick={() =>
              run(async () => {
                // Grams logged scale with the dose (e.g. 5 g creatine = 5 g; 2 capsules = 2× the capsule weight).
                await saveSupplementPlan(personId, { dose, doseUnit: plan.doseUnit, gramsPerDose: (plan.gramsPerDose / plan.dose) * dose, times: time ? [time] : [], daysOfWeek: days, foodId: undefined, code: plan.code ?? undefined }, plan.id);
                setEdit(false);
              }, "Pauta actualizada")
            }
          >
            Guardar
          </Button>
        </div>
      ) : null}
    </li>
  );
}
