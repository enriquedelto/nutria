"use client";
import { useState, useTransition } from "react";
import { Lock, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteTargetSet, recalcTargets, saveTargets } from "@/actions/health";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type TargetSet = { id?: string; name: string; kcal: number; protein: number; carbs: number; fat: number; fiber: number | null; mode: "fixed" | "dynamic" | "adaptive"; pinned: string[]; rule: { days?: number[]; trainingDay?: boolean }; isDefault?: boolean };
const DAYS = ["L", "M", "X", "J", "V", "S", "D"];
const MACROS = [
  ["protein", "Proteína", 4],
  ["carbs", "Hidratos", 4],
  ["fat", "Grasa", 9],
] as const;

export function TargetEditor({ personId, initial, trigger }: { personId: string; initial: TargetSet; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(initial);
  const [pending, start] = useTransition();
  const macroKcal = t.protein * 4 + t.carbs * 4 + t.fat * 9;
  const set = <K extends keyof TargetSet>(k: K, v: TargetSet[K]) => setT((x) => ({ ...x, [k]: v }));
  const pin = (k: string) => set("pinned", t.pinned.includes(k) ? t.pinned.filter((x) => x !== k) : [...t.pinned, k]);
  /** Change kcal and rescale the unpinned macros to fit. */
  const setKcal = (kcal: number) => {
    const fixed = MACROS.filter(([k]) => t.pinned.includes(k)).reduce((a, [k, , f]) => a + t[k] * f, 0);
    const free = MACROS.filter(([k]) => !t.pinned.includes(k));
    const freeKcal = free.reduce((a, [k, , f]) => a + t[k] * f, 0);
    const ratio = freeKcal > 0 ? Math.max(0, kcal - fixed) / freeKcal : 1;
    setT((x) => ({ ...x, kcal, ...Object.fromEntries(free.map(([k]) => [k, Math.round(x[k] * ratio)])) }));
  };
  const isSpecial = !initial.isDefault;
  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent title={initial.id ? `Editar «${initial.name}»` : "Nuevo conjunto de objetivos"} description="Fija (🔒) un macro para que no cambie cuando ajustes las calorías o el TDEE adaptativo.">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  try {
                    await saveTargets(personId, { ...t, pinned: t.pinned as never });
                    toast.success("Objetivos guardados");
                    setOpen(false);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Error");
                  }
                });
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                <Field label="Nombre">
                  <Input value={t.name} onChange={(e) => set("name", e.target.value)} maxLength={40} required />
                </Field>
                <Field label="Modo">
                  <Select value={t.mode} onChange={(e) => set("mode", e.target.value as TargetSet["mode"])}>
                    <option value="dynamic">Calculado (perfil)</option>
                    <option value="adaptive">Adaptativo (TDEE real)</option>
                    <option value="fixed">Fijo (manual)</option>
                  </Select>
                </Field>
              </div>
              <Field label="Calorías">
                <Input type="number" min={500} max={8000} value={t.kcal} onChange={(e) => setKcal(Number(e.target.value))} className="num" />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                {MACROS.map(([k, label, f]) => (
                  <Field
                    key={k}
                    label={
                      <span className="flex items-center gap-1">
                        {label}
                        <button type="button" aria-label={`Fijar ${label}`} aria-pressed={t.pinned.includes(k)} onClick={() => pin(k)} className={cn("rounded p-0.5", t.pinned.includes(k) ? "text-herb" : "text-ink-3")}>
                          <Lock className="size-3.5" />
                        </button>
                      </span>
                    }
                    hint={`${Math.round(((t[k] * f) / Math.max(1, macroKcal)) * 100)} %`}
                  >
                    <Input type="number" min={0} value={t[k]} onChange={(e) => set(k, Number(e.target.value))} className="num" />
                  </Field>
                ))}
              </div>
              <p className={cn("text-xs", Math.abs(macroKcal - t.kcal) > 50 ? "text-persimmon" : "text-ink-3")}>Los macros suman {Math.round(macroKcal)} kcal.</p>
              <Field label="Fibra (g)">
                <Input type="number" min={0} max={150} value={t.fiber ?? ""} onChange={(e) => set("fiber", e.target.value ? Number(e.target.value) : null)} className="num" />
              </Field>
              {isSpecial ? (
                <fieldset className="space-y-2 rounded-xl bg-paper-2 p-3">
                  <legend className="text-sm font-medium">Cuándo se aplica</legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={t.rule.trainingDay === true} onChange={(e) => set("rule", { ...t.rule, trainingDay: e.target.checked ? true : undefined })} className="accent-[var(--herb)]" />
                    Días con entreno registrado (manual u openGym)
                  </label>
                  <div className="flex gap-1">
                    {DAYS.map((d, i) => (
                      <button key={d} type="button" aria-pressed={t.rule.days?.includes(i + 1)} onClick={() => set("rule", { ...t.rule, days: t.rule.days?.includes(i + 1) ? t.rule.days.filter((x) => x !== i + 1) : [...(t.rule.days ?? []), i + 1] })} className={cn("size-9 rounded-full border text-sm", t.rule.days?.includes(i + 1) ? "border-herb bg-herb text-herb-ink" : "border-line bg-card")}>
                        {d}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <Button type="submit" className="w-full" disabled={pending}>
                Guardar
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export function NewSpecialSet({ personId, base }: { personId: string; base: TargetSet }) {
  return (
    <TargetEditor
      personId={personId}
      initial={{ ...base, id: undefined, name: "Día de entreno", isDefault: false, rule: { trainingDay: true }, mode: "fixed", kcal: base.kcal + 250, carbs: base.carbs + 60 }}
      trigger={
        <Button size="sm" variant="outline">
          <Plus /> Día especial
        </Button>
      }
    />
  );
}

export function TargetRowActions({ personId, id, canDelete }: { personId: string; id: string; canDelete: boolean }) {
  const [pending, start] = useTransition();
  return canDelete ? (
    <Button size="icon-sm" variant="ghost" aria-label="Borrar" disabled={pending} onClick={() => start(() => deleteTargetSet(personId, id))}>
      <Trash2 />
    </Button>
  ) : null;
}

export function Recalc({ personId }: { personId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="soft" disabled={pending} onClick={() => start(async () => {
      await recalcTargets(personId);
      toast.success("Objetivos recalculados con tu perfil actual");
    })}>
      <RefreshCw className={pending ? "animate-spin" : ""} /> Recalcular
    </Button>
  );
}
