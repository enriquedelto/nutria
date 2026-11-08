"use client";
import { errorText } from "@/lib/errors";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createChallenge, deleteChallenge, joinChallenge, leaveChallenge, refreshProgress, type ChallengeMetric } from "@/actions/challenges";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const err = (e: unknown) => toast.error(errorText(e, "Algo ha fallado"));
const plus = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export function RefreshProgress({ personId, timezone }: { personId: string; timezone: string }) {
  const [pending, start] = useSafeTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            const n = await refreshProgress(personId, timezone);
            if (n.length) toast.success(`¡${n.length} logro${n.length === 1 ? "" : "s"} nuevo${n.length === 1 ? "" : "s"}!`);
          } catch (e) {
            err(e);
          }
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Actualizar
    </Button>
  );
}

export function ChallengeActions({ challengeId, personId, joined, ended }: { challengeId: string; personId: string; joined: boolean; ended: boolean }) {
  const [pending, start] = useSafeTransition();
  return (
    <div className="flex items-center gap-1">
      {!ended ? (
        <Button size="sm" variant={joined ? "ghost" : "soft"} disabled={pending} onClick={() => start(async () => void (await (joined ? leaveChallenge : joinChallenge)(challengeId, personId).catch(err)))}>
          {joined ? "Salir" : "Unirme"}
        </Button>
      ) : null}
      <Button size="icon-sm" variant="ghost" aria-label="Borrar reto" disabled={pending} onClick={() => start(async () => void (await deleteChallenge(challengeId).catch(err)))}>
        <Trash2 />
      </Button>
    </div>
  );
}

const PRESETS: { title: string; metric: ChallengeMetric; days: number; target?: number }[] = [
  { title: "Semana registrando todo", metric: "logging_days", days: 7, target: 7 },
  { title: "Dos semanas bien hidratados", metric: "water_days", days: 14, target: 14 },
  { title: "Mes de fruta y verdura", metric: "veggie_days", days: 30, target: 20 },
  { title: "Reto de pasos", metric: "steps", days: 7, target: 70 },
];

export function NewChallenge({ today, members, metrics }: { today: string; members: { id: string; name: string }[]; metrics: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useSafeTransition();
  const [form, setForm] = useState({ title: "", metric: "logging_days" as ChallengeMetric, start: today, end: plus(today, 6), target: "" as string, description: "" });
  const [who, setWho] = useState<string[]>(() => members.map((m) => m.id));
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> Nuevo reto
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Nuevo reto" description="Se puntúa solo con lo que cada uno registra; se recalcula cada noche.">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.title} type="button" className="rounded-full border border-line px-2.5 py-1 text-xs hover:border-herb" onClick={() => setForm((f) => ({ ...f, title: p.title, metric: p.metric, end: plus(f.start, p.days - 1), target: p.target ? String(p.target) : "" }))}>
                {p.title}
              </button>
            ))}
          </div>
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                try {
                  await createChallenge({ title: form.title, description: form.description || undefined, metric: form.metric, startDate: form.start, endDate: form.end, personIds: who, target: Number(form.target) || null });
                  setOpen(false);
                } catch (x) {
                  err(x);
                }
              });
            }}
          >
            <Field label="Título" className="col-span-2">
              <Input required maxLength={100} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Se cuenta" className="col-span-2">
              <Select value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value as ChallengeMetric })}>
                {Object.entries(metrics).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Empieza">
              <Input type="date" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
            </Field>
            <Field label="Termina">
              <Input type="date" required min={form.start} value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
            </Field>
            <Field label="Meta (opcional)">
              <Input type="number" min={1} value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
            </Field>
            <Field label="Descripción" className="col-span-2">
              <Textarea rows={2} maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Participan" className="col-span-2">
              <div className="flex flex-wrap gap-2">
                {members.map((m) => {
                  const on = who.includes(m.id);
                  return (
                    <button key={m.id} type="button" onClick={() => setWho((w) => (on ? w.filter((x) => x !== m.id) : [...w, m.id]))} className={cn("rounded-full border px-3 py-1 text-sm", on ? "border-herb bg-herb/10 text-herb" : "border-line text-ink-2")}>
                      {m.name}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Button type="submit" className="col-span-2" disabled={pending}>
              Crear reto
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
